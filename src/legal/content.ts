// Terms, privacy policy, and community guidelines. Plain language, specific to how Assembly works.
// Update EFFECTIVE when anything material changes, and say what changed at the top of the page.

export const EFFECTIVE = "October 26, 2026";
export const OPERATOR = "Matt Ladner";
export const CONTACT = "hello@assembly.rsvp";

export interface LegalDoc {
  slug: "terms" | "privacy" | "guidelines";
  title: string;
  lede: string;
  sections: { heading: string; body: (string | string[])[] }[];
}

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy policy",
  lede: "Event details are public so people can plan. Everything about you stays as private as we can make it. We don't sell data, run ads, or use tracking pixels.",
  sections: [
    {
      heading: "Who we are",
      body: [`Assembly (assembly.rsvp) is run by ${OPERATOR} in Memphis, Tennessee. Questions or requests: ${CONTACT}.`],
    },
    {
      heading: "What we collect",
      body: [
        [
          "Account: your name, email address, and profile photo, plus an identifier from Google or Apple if you sign in with them. If you sign in by email code, just your email.",
          "Profile details you choose to add: pronouns, bio, scenes, and links.",
          "Events you post: everything in the announcement, including flyers, promo videos, the address, and the lineup.",
          "RSVPs: which events you marked going or interested.",
          "Check-ins: which events you checked in to, when, how (location or door code), and when you checked out. Never where you were.",
          "Wall photos you post, their captions, and whether you posted without your name.",
          "Comments you post on event pages, when you posted or edited them, and the people you mute or block from comments.",
          "Friends: your username if you choose one, who you're friends with, requests, people you block or hide your nights from, and whether friends see a given night.",
          "Notifications: if you turn them on, the push address your browser gives us for this device.",
          "Reports you send, and reports others send about events or accounts.",
          "Basic technical logs (time, page requested, IP address, browser) kept by our host for security and debugging.",
        ],
      ],
    },
    {
      heading: "What's public and what isn't",
      body: [
        "Public: everything in an event you post (including its full address), and the name and photo of the organizer who posted it. Anyone can see these without signing in. The posting form says so before you post.",
        "Private by default: your RSVPs, your email, and everything else on your profile. Your RSVPs only count toward an event's total unless you turn on \"Show me on who's going lists\" in your profile.",
        "Reports are private. The person or organizer reported doesn't see who sent them.",
        "Event walls: photos are visible to the host and to people who RSVP'd or checked in to that event. The host can pick a few as highlights, which anyone with the event link can see. If you post without your name, other people (the host included) don't see who posted it; moderators can, to handle abuse.",
        "Comments: anyone who can see the event can read its comments, with your name and photo, unless the host turned comments off. Hosts and moderators can remove comments. Nobody is told when you mute or block them.",
        "Check-ins: others see only how many people are checked in, not who.",
        "Friends: only after you turn friends on, your friends (people you both accepted) see the events you RSVP'd Going to or checked in to. You can keep any night just for you, hide your nights from one friend, or turn friends off, which hides you from everyone at once. Friends never see a location, only the event. Nobody, including other friends and hosts, can see your friend list. Blocking someone ends the friendship and they aren't told.",
        "\"Everyone here\" for a night: besides friends, people checked in to the same event see your name and photo while you're both there. Only people checked in can see that list.",
        "Check-in alerts: friends who asked to be told get a notification when you check in, if that night is shared with friends. Event invites from friends arrive as a notification and under Friends.",
        "Finding friends from contacts: only if you turn on \"find me by email\", we keep a one-way hash of your verified sign-in email. When someone checks their contacts, their phone hashes the addresses and sends only the first few characters of each hash; matching finishes on their phone, so we never learn who's in anyone's contacts. Phone numbers aren't used.",
      ],
    },
    {
      heading: "Location",
      body: [
        "We don't track or store your device's location. The map shows events where organizers placed them.",
        "If you tap the locate button, your browser asks for permission, then the map shows your position as a dot and cards show how far away each event is. That position stays on your device: it's never sent to Assembly, never saved, and never logged. Your device only remembers that you turned location on, so it doesn't ask again. Tap the button again to turn it off and clear the dot.",
        "Check-in by location works the same way: your phone compares its position with the event's and sends only whether you're close. Your coordinates never leave your device. You can always check in with the door code instead.",
        "Wall photos are re-saved on your phone before upload, which removes location and camera details from the file.",
        "Address search in the posting form sends what you type to Photon, an OpenStreetMap search service run by Komoot, to find matching addresses.",
      ],
    },
    {
      heading: "Who we share it with",
      body: [
        "We share data only with the services that run Assembly, and only what they need:",
        [
          "Cloudflare: hosting, database, file and video storage, and sending sign-in emails.",
          "Google and Apple: only if you choose to sign in with them.",
          "Your browser's push service (Google, Apple, Mozilla, or Microsoft): encrypted notification messages, if you turn notifications on. They can't read the contents.",
          "OpenFreeMap: the map tiles your browser loads, which means it sees your IP address like any website would.",
        ],
        "We don't sell or rent personal data. We'll disclose information if the law requires it, and we'll tell you first when we're allowed to.",
      ],
    },
    {
      heading: "Cookies and storage",
      body: [
        "One cookie keeps you signed in. We store a few preferences on your device, such as light or dark mode, your last map filters, whether you've dismissed the home screen tip, and a draft of an announcement you haven't posted. Events you RSVP to are saved on your device so they open offline at the door. Signing out clears your personal data from the device. If we turn on Cloudflare Web Analytics, it counts visits without cookies.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "Removed wall photos are deleted from storage right away. A removed comment's words are deleted right away; a placeholder stays if others replied to it. Your account and content stay until you delete them. Sign-in codes expire after 10 minutes. Server logs are kept for a short time by our host. Promo videos may be removed some time after an event to keep storage costs down.",
      ],
    },
    {
      heading: "Your choices",
      body: [
        [
          "Edit your profile or remove your photo any time.",
          "Edit or remove your own comments, and see or undo who you muted or blocked, in your profile.",
          "Turn notifications off in your profile or your browser settings.",
          "Delete your account in your profile. That removes your profile, sign-in methods, RSVPs, photos, and events you host alone, and signs you out everywhere.",
          `Ask for a copy of your data, or for anything else, at ${CONTACT}.`,
        ],
      ],
    },
    {
      heading: "Age",
      body: ["Assembly is for people 18 and older. We don't knowingly collect data from anyone younger, and we'll delete an account if we learn it belongs to someone under 18."],
    },
    {
      heading: "Security",
      body: [
        "Sign-in sessions use a secure cookie and are stored only as a one-way hash. We don't store passwords at all. Photos are re-saved on your device before upload, which strips location data and camera details. No system is perfect; if we learn of a breach that affects you, we'll tell you.",
      ],
    },
    {
      heading: "Changes",
      body: ["If we change this policy in a way that matters, we'll update the date above and post a notice in the app before it takes effect."],
    },
  ],
};

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of use",
  lede: "The short version: be at least 18, post real events you have the right to post, respect people, and know that Assembly lists events but doesn't run them or sell tickets.",
  sections: [
    {
      heading: "Agreement",
      body: [
        `These terms are between you and ${OPERATOR}, who runs Assembly (assembly.rsvp). By creating an account or posting, you agree to them, along with the Privacy policy and Community guidelines.`,
      ],
    },
    {
      heading: "Who can use Assembly",
      body: ["You must be 18 or older to make an account. You're responsible for what happens under your account, so keep your email and sign-in methods secure."],
    },
    {
      heading: "Posting events",
      body: [
        "If you post an event, you confirm that:",
        [
          "The details are accurate, and you'll update or cancel the event if they change.",
          "You're the organizer or have their permission, and the venue or host knows the address will be public.",
          "The event and how it's run are legal, and you're responsible for permits, capacity, age checks, and safety.",
          "You have the rights to the flyer, video, and anything else you upload.",
        ],
        "A new organizer's first event is reviewed before it appears. After that, events go live right away, and we may still review, hide, or remove them.",
      ],
    },
    {
      heading: "Your content",
      body: [
        "You keep ownership of what you post. You give us a non-exclusive, worldwide, royalty-free license to host, display, resize, and share it in Assembly and in links and share cards that promote the event, for as long as it's on Assembly. Deleting the event or your account ends the license, except for copies already shared by others.",
      ],
    },
    {
      heading: "Event walls",
      body: [
        "You can post photos to an event's wall after checking in, or as its host, from doors until a week after the event. Only post photos you took. Ask before you post someone's face, and take it down if they ask.",
        "Anyone shown in a photo can ask for it to come down: it's hidden right away while we review it. The host can remove any photo on their event's wall or turn the wall off. Events tagged \"No photos on the floor\" have no wall.",
        "No nudity, drug use, private areas (bathrooms, backstage, green rooms), or anyone under age, and no photos at all of anyone under 21 at a 21+ event. We remove these and may suspend the account.",
      ],
    },
    {
      heading: "Comments",
      body: [
        "Anyone signed in can comment on an event page while its host has comments open. Keep it about the event. The host can pin a comment, remove comments, or set comments to read only or off.",
        "Comments reported by three different people are hidden until a moderator reviews them. You can edit or remove your own comments; edits are marked.",
      ],
    },
    {
      heading: "Tickets and payments",
      body: [
        "Assembly doesn't sell tickets or handle money. Ticket links go to other services (like RA, DICE, Eventbrite, or Venmo) and their terms apply. Refunds, entry, and disputes are between you and the organizer.",
      ],
    },
    {
      heading: "Going to events",
      body: [
        "Organizers, not Assembly, run events. We don't check venues, vet attendees, or guarantee that an event happens as listed. Use your judgment, look out for each other, and report anything unsafe.",
      ],
    },
    {
      heading: "Not allowed",
      body: [
        "Anything that breaks the Community guidelines, including hateful or harassing content, selling drugs or weapons, sexual services, fake events, scams, spam, impersonation, or posting someone's private address without permission. Don't try to break, overload, or scrape the service, or get around limits, bans, or reviews.",
      ],
    },
    {
      heading: "Moderation",
      body: [
        "We may remove content or suspend accounts that break these terms or put people at risk, with or without notice. Events, comments, and wall photos reported by several people are hidden until a moderator reviews them. If you think we got it wrong, write to us.",
      ],
    },
    {
      heading: "Copyright",
      body: [`If something on Assembly infringes your copyright, email ${CONTACT} with the link, what it infringes, and your contact details, and we'll take it down while we sort it out.`],
    },
    {
      heading: "No warranty",
      body: [
        "Assembly is provided as is. We work to keep it accurate and running, but we don't promise it will be error-free or always available, or that listings are correct.",
      ],
    },
    {
      heading: "Limits on liability",
      body: [
        "To the extent the law allows, Assembly and its operator aren't liable for indirect or consequential damages, or for anything that happens at an event, between attendees and organizers, or on other services we link to. Our total liability for any claim is limited to $100.",
      ],
    },
    {
      heading: "Ending your use",
      body: ["You can delete your account at any time. We may suspend or end access if you break these terms. Sections about content licenses already used, liability, and disputes still apply afterward."],
    },
    {
      heading: "Law and disputes",
      body: ["These terms are governed by the laws of Tennessee. Disputes go to the state or federal courts in Shelby County, Tennessee, unless the law where you live says otherwise."],
    },
    {
      heading: "Changes",
      body: ["If we change these terms in a way that matters, we'll update the date above and post a notice in the app before the changes take effect. Continuing to use Assembly after that means you accept them."],
    },
    {
      heading: "Contact",
      body: [`${CONTACT}`],
    },
  ],
};

export const GUIDELINES: LegalDoc = {
  slug: "guidelines",
  title: "Community guidelines",
  lede: "Assembly is for underground music: DIY shows, raves, queer nights, small rooms. These rules keep it useful and safe, especially for people walking into a new room for the first time.",
  sections: [
    {
      heading: "Make rooms people can trust",
      body: [
        [
          "Be accurate. Real address, real times, real lineup. Update the event when plans change, and cancel it if it's off.",
          "Use door tags honestly. Queer-centered, all ages, 21+, sliding scale, accessible entrance, sober-friendly: people decide whether to come based on them.",
          "Only post an address you have permission to make public. House shows and DIY spaces: check with the host first.",
          "Post flyers and videos you made or have permission to use.",
        ],
      ],
    },
    {
      heading: "Not allowed",
      body: [
        [
          "Hate or harassment based on race, ethnicity, religion, gender, gender identity, sexual orientation, disability, or anything else about who someone is.",
          "Selling or arranging drugs, weapons, or other illegal goods.",
          "Sexual services or explicit sexual content.",
          "Fake events, bait-and-switch lineups, scams, and spam.",
          "Pretending to be another organizer, artist, or venue.",
          "Sharing someone's private information, in an event, a comment, or anywhere else.",
          "Comments that pile on, bait, or follow someone from event to event.",
          "Wall photos of people who didn't agree to be posted, of anyone under age, of nudity or drug use, or taken in private areas like bathrooms and backstage.",
        ],
      ],
    },
    {
      heading: "Encouraged",
      body: [
        "Harm reduction information is welcome: water, chill-out spaces, naloxone, testing, ride plans, who to find if something goes wrong. So is accessibility detail, like stairs, ramps, restrooms, and noise.",
      ],
    },
    {
      heading: "Reporting",
      body: [
        "Use \"Report this event\" or \"Report the organizer\" on any event page. Reports are private. An event reported by three different people is hidden until a moderator reviews it, and we aim to respond within 12 hours on weekends.",
        "On a comment, tap ⋯ then Report. Three reports hide it until a moderator looks. You can also mute someone (you stop seeing their comments) or block them (they also can't reply to you or comment on your events). They aren't told.",
        "On a wall photo, tap Report. If you're in the photo and want it gone, choose \"I'm in this photo\": it comes down right away.",
        "If someone is in danger, call 911 first.",
      ],
    },
    {
      heading: "What happens if you break these",
      body: ["We may hide or remove events, remove a verified badge, or suspend accounts. Serious cases, such as threats or selling drugs, mean immediate removal."],
    },
    {
      heading: "Verified organizers",
      body: ["The verified badge means the Assembly team knows who's behind an account. It isn't a safety guarantee for a specific event, and we can take it away."],
    },
  ],
};

export const DOCS = { terms: TERMS, privacy: PRIVACY, guidelines: GUIDELINES } as const;
