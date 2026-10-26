import type { FriendAt } from "../../shared/types";
import { FriendAvatar } from "../app/FriendsSheet";

/** Up to three friends' faces, here-now first (ringed), then "+N". */
export function Faces({ people, size = 22, label = true }: { people: FriendAt[]; size?: number; label?: boolean }) {
  if (!people.length) return null;
  const here = people.filter((p) => p.state === "here").length;
  const text =
    people.length === 1
      ? `${people[0].displayName} ${people[0].state === "here" ? "is here" : "is going"}`
      : `${people.length} friends${here ? `, ${here} here` : " going"}`;
  return (
    <span className="faces" aria-label={text} title={text}>
      {people.slice(0, 3).map((p) => (
        <span key={p.id} className={`face ${p.state === "here" ? "is-here-wrap" : ""}`}>
          <FriendAvatar p={p} size={size} />
        </span>
      ))}
      {label && <span className="faces-more">{text}</span>}
    </span>
  );
}
