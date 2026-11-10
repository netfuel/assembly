// Check-in achievements: what the marks are called and how they read. The rules that decide who has earned one
// live in worker/achievements.ts and run on the server from check-ins only; nothing here can award anything.

export interface AchievementDef {
  id: string;
  name: string;
  /** Shown on the locked outline: what to do, in a few words. */
  hint: string;
  /** One small typographic mark, drawn in text so it needs no asset and follows the theme. */
  glyph: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first-night", name: "First night", hint: "Check in to your first night.", glyph: "✦" },
  { id: "three-nights", name: "Regular", hint: "Check in on 3 different nights.", glyph: "◐" },
  { id: "five-venues", name: "Room hopper", hint: "Check in at 5 different venues.", glyph: "❖" },
  { id: "week-streak", name: "Week streak", hint: "Check in on 3 nights within 7 days.", glyph: "≋" },
  { id: "queer-night", name: "Queer-centered night", hint: "Check in at a queer-centered night.", glyph: "◈" },
  { id: "last-call", name: "Last call", hint: "Check in during the last hour of a night.", glyph: "☾" },
] as const;

export const achievementDef = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

/** One of your own marks. Only you see the event and venue it came from, unless you opt in for friends. */
export interface MyMark {
  id: string;
  name: string;
  glyph: string;
  earnedAt: string;
  eventId: string;
  eventTitle: string;
  venueName: string | null;
  hidden: boolean;
}
export interface LockedMark {
  id: string;
  name: string;
  hint: string;
}
export interface MyAchievements {
  marks: MyMark[];
  locked: LockedMark[];
  /** Hide every mark from friends. */
  hideAll: boolean;
  /** Friends also see the venue and time of day for marks that aren't hidden. */
  shareDetail: boolean;
}

/** What a friend sees: the name and the date. Venue and time only when the person opted in. */
export interface FriendMark {
  name: string;
  glyph: string;
  date: string;
  venue?: string | null;
  time?: string;
}

/** Marks a check-in just earned, for the one toast. */
export interface EarnedNow {
  id: string;
  name: string;
  glyph: string;
}
