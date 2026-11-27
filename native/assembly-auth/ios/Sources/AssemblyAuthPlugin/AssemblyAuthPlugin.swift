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
@objc(AssemblyAuthPlugin)
public class AssemblyAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "AssemblyAuthPlugin"
    public let jsName = "AssemblyAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise)
    ]

    /// Held while the sheet is open; the system drops a session nobody holds.
    private var session: ASWebAuthenticationSession?

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
}
