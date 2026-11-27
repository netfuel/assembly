import Foundation
import Capacitor
import AuthenticationServices
import Security

/// Assembly's own plugin (docs/ios.md). Two jobs:
///
/// - `authenticate`: runs a Google or Apple sign-in in the system sign-in sheet (ASWebAuthenticationSession).
///   Google refuses sign-in inside an app's web view, and the sheet shares Safari's sign-ins, so it's usually
///   one tap. The sheet closes when the server sends it to rsvp.assembly.app://auth, and that URL comes back.
/// - `getToken` / `setToken` / `clearToken`: the session token, kept in the keychain on this device only.
/// - `passkeyRegister` / `passkeySignIn`: Apple's passkey sheet (Face ID, synced by iCloud Keychain) for the
///   site's relying party, assembly.rsvp. The app may use it because of the webcredentials entitlement and the
///   site's apple-app-site-association file. Options go in and results come out as WebAuthn JSON, so the server
///   (worker/passkeys.ts) checks them exactly as it checks a browser's.
@objc(AssemblyAuthPlugin)
public class AssemblyAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AssemblyAuthPlugin"
    public let jsName = "AssemblyAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "passkeyRegister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "passkeySignIn", returnType: CAPPluginReturnPromise)
    ]

    /// Held while the sheet is open; the system drops a session nobody holds.
    private var session: ASWebAuthenticationSession?

    /// The passkey request in flight, and the JS call waiting for it.
    private var passkeyController: ASAuthorizationController?
    private var passkeyCall: CAPPluginCall?

    private let keychainService = "rsvp.assembly.app.session"
    private let keychainAccount = "session-token"

    // MARK: Sign-in sheet

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme == "https",
              let callbackScheme = call.getString("callbackScheme"),
              !callbackScheme.isEmpty else {
            call.reject("authenticate needs an https url and a callbackScheme")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.session != nil {
                call.reject("A sign-in is already open")
                return
            }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                    return
                }
                if let error = error {
                    call.reject(error.localizedDescription, nil, error)
                    return
                }
                guard let callbackURL = callbackURL else {
                    call.reject("The sign-in sheet closed without an answer")
                    return
                }
                call.resolve(["url": callbackURL.absoluteString])
            }
            session.presentationContextProvider = self
            // Share Safari's sign-ins (Google, Apple ID): one tap for most people. iOS asks once to allow it.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Couldn't open the sign-in sheet")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.webView?.window ?? ASPresentationAnchor()
    }

    // MARK: Keychain

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
    }

    @objc func getToken(_ call: CAPPluginCall) {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let token = String(data: data, encoding: .utf8) {
            call.resolve(["token": token])
        } else if status == errSecItemNotFound {
            call.resolve([:])
        } else {
            call.reject("Couldn't read the keychain (\(status))")
        }
    }

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let data = token.data(using: .utf8) else {
            call.reject("setToken needs a token")
            return
        }
        SecItemDelete(baseQuery() as CFDictionary)
        var item = baseQuery()
        item[kSecValueData as String] = data
        // Readable after the first unlock (so a push or background refresh can use it), never backed up off the device.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Couldn't save to the keychain (\(status))")
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Couldn't clear the keychain (\(status))")
        }
    }
    // MARK: Passkeys

    private static func b64urlDecode(_ s: String) -> Data? {
        var base64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return Data(base64Encoded: base64)
    }

    private static func b64url(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func perform(_ request: ASAuthorizationRequest, for call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.passkeyCall != nil {
                call.reject("A passkey request is already open")
                return
            }
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.passkeyController = controller
            self.passkeyCall = call
            controller.performRequests()
        }
    }

    /// Makes a passkey from WebAuthn creation options (`PublicKeyCredentialCreationOptionsJSON`).
    @objc func passkeyRegister(_ call: CAPPluginCall) {
        guard let options = call.getObject("options"),
              let rpId = (options["rp"] as? JSObject)?["id"] as? String,
              let user = options["user"] as? JSObject,
              let userIdString = user["id"] as? String, let userId = Self.b64urlDecode(userIdString),
              let userName = user["name"] as? String,
              let challengeString = options["challenge"] as? String, let challenge = Self.b64urlDecode(challengeString) else {
            call.reject("passkeyRegister needs WebAuthn creation options")
            return
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: userId)
        if #available(iOS 17.4, *), let exclude = options["excludeCredentials"] as? JSArray {
            request.excludedCredentials = exclude.compactMap { item in
                guard let id = (item as? JSObject)?["id"] as? String, let data = Self.b64urlDecode(id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: data)
            }
        }
        perform(request, for: call)
    }

    /// Signs with a passkey from WebAuthn request options (`PublicKeyCredentialRequestOptionsJSON`).
    @objc func passkeySignIn(_ call: CAPPluginCall) {
        guard let options = call.getObject("options"),
              let rpId = options["rpId"] as? String,
              let challengeString = options["challenge"] as? String, let challenge = Self.b64urlDecode(challengeString) else {
            call.reject("passkeySignIn needs WebAuthn request options")
            return
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        if let allow = options["allowCredentials"] as? JSArray, !allow.isEmpty {
            request.allowedCredentials = allow.compactMap { item in
                guard let id = (item as? JSObject)?["id"] as? String, let data = Self.b64urlDecode(id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: data)
            }
        }
        perform(request, for: call)
    }

    private func finishPasskey() -> CAPPluginCall? {
        let call = passkeyCall
        passkeyCall = nil
        passkeyController = nil
        return call
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = finishPasskey() else { return }
        if let reg = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = reg.rawAttestationObject else {
                call.reject("The passkey came back without an attestation")
                return
            }
            let id = Self.b64url(reg.credentialID)
            let transports: JSArray = ["internal", "hybrid"]
            call.resolve([
                "response": [
                    "id": id,
                    "rawId": id,
                    "type": "public-key",
                    "authenticatorAttachment": "platform",
                    "clientExtensionResults": JSObject(),
                    "response": [
                        "clientDataJSON": Self.b64url(reg.rawClientDataJSON),
                        "attestationObject": Self.b64url(attestation),
                        "transports": transports
                    ] as JSObject
                ] as JSObject
            ])
        } else if let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            let id = Self.b64url(assertion.credentialID)
            call.resolve([
                "response": [
                    "id": id,
                    "rawId": id,
                    "type": "public-key",
                    "authenticatorAttachment": "platform",
                    "clientExtensionResults": JSObject(),
                    "response": [
                        "clientDataJSON": Self.b64url(assertion.rawClientDataJSON),
                        "authenticatorData": Self.b64url(assertion.rawAuthenticatorData),
                        "signature": Self.b64url(assertion.signature),
                        "userHandle": Self.b64url(assertion.userID)
                    ] as JSObject
                ] as JSObject
            ])
        } else {
            call.reject("Unexpected credential type")
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = finishPasskey() else { return }
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.resolve(["cancelled": true])
            return
        }
        call.reject(error.localizedDescription, nil, error)
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return self.bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
