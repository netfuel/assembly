import { useEffect, useState } from "react";
import { Button, Chip, Disclosure, Label, Segmented, Sheet } from "../components/ui";
import { POLICY_TAGS, SCENES, VENUE_TYPES, type SceneId } from "../../shared/types";
import { DEFAULT_FILTERS, PRESETS, PRICES, activeCount, type Filters, type PriceId } from "../lib/filters";

// Door policies people filter on. "No photos" and BYOB are info, not something to search by.
const POLICY_FILTERS = ["all-ages", "18+", "21+", "sliding-scale", "accessible-entrance", "sober-friendly", "harm-reduction"];

type Group = "door" | "price" | "venue";

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const same = (a: Filters, b: Partial<Filters>) =>
  (Object.keys(b) as (keyof Filters)[]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const summary = (labels: string[]) => (labels.length ? labels.join(", ") : "Any");

/**
 * What isn't the time window: scene, door policy, price, venue type. The time window is the date pill's job, so it
 * isn't repeated here. Scene is open because it's the filter people reach for; Door, Price and Venue are one quiet row
 * each, and a row with something set starts open so nothing that's on is hidden. Changes are a draft until Apply,
 * which shows how many events match. Bottom sheet on phones (swipe down to close), side panel on wide screens.
 */
export function FilterSheet({
  open,
  onClose,
  filters,
  friendsOn = false,
  count,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  /** Show the Friends filter (only when friends are on). */
  friendsOn?: boolean;
  count: (f: Filters) => number;
  onApply: (f: Filters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [rows, setRows] = useState<Record<Group, boolean>>({ door: false, price: false, venue: false });
  // Start each visit from what's applied now.
  useEffect(() => {
    if (!open) return;
    setDraft(filters);
    setRows({ door: filters.policies.length > 0, price: filters.price !== "any", venue: filters.venueTypes.length > 0 });
  }, [open, filters]);
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const flip = (g: Group) => setRows((r) => ({ ...r, [g]: !r[g] }));
  const n = count(draft);
  // Clear all leaves the time window where the date pill has it.
  const cleared: Filters = { ...DEFAULT_FILTERS, windowId: draft.windowId, date: draft.date };
  const dirty = activeCount({ ...draft, windowId: "tonight" }) > 0;

  return (
    <Sheet open={open} onClose={onClose} label="Filters" modal className="sheet-filters">
      <form
        className="filter-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <div className="stack" data-reveal>
          <Label glyph="≡">Filters</Label>
          <h1 className="sheet-title">Find your night.</h1>
        </div>

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">Quick picks</legend>
          <div className="chip-row">
            {PRESETS.map((p) => (
              <Chip key={p.id} pressed={same(draft, p.filters)} onClick={() => setDraft({ ...DEFAULT_FILTERS, date: draft.date, ...p.filters })}>
                {p.label}
              </Chip>
            ))}
          </div>
        </fieldset>

        {friendsOn && (
          <fieldset className="filter-group" data-reveal>
            <legend className="field-label">Friends</legend>
            <div className="chip-row">
              <Chip pressed={draft.friends} onClick={() => set({ friends: !draft.friends })}>
                ◎ Friends going
              </Chip>
            </div>
          </fieldset>
        )}

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">Scene</legend>
          <div className="chip-row">
            {SCENES.map((s) => (
              <Chip
                key={s.id}
                pressed={draft.scenes.includes(s.id)}
                marker={s.id === "queer" ? "var(--color-uv)" : undefined}
                onClick={() => set({ scenes: toggle<SceneId>(draft.scenes, s.id) })}
              >
                {s.label}
              </Chip>
            ))}
          </div>
          <p className="note">Any of these.</p>
        </fieldset>

        <div className="filter-more" data-reveal>
          <Disclosure id="door" title="Door" summary={summary(draft.policies.map((p) => POLICY_TAGS[p]))} open={rows.door} onToggle={() => flip("door")}>
            <div className="chip-row">
              {POLICY_FILTERS.map((id) => (
                <Chip key={id} pressed={draft.policies.includes(id)} onClick={() => set({ policies: toggle(draft.policies, id) })}>
                  {POLICY_TAGS[id]}
                </Chip>
              ))}
            </div>
            <p className="note">All of these.</p>
          </Disclosure>

          <Disclosure
            id="price"
            title="Price"
            summary={draft.price === "any" ? "Any" : (PRICES.find((p) => p.id === draft.price)?.label ?? "Any")}
            open={rows.price}
            onToggle={() => flip("price")}
          >
            <Segmented label="Price" options={PRICES} value={draft.price} onChange={(price: PriceId) => set({ price })} />
            {draft.price !== "any" && <p className="note">Events without a listed price are left out.</p>}
          </Disclosure>

          <Disclosure id="venue" title="Venue" summary={summary(draft.venueTypes.map((v) => VENUE_TYPES[v]))} open={rows.venue} onToggle={() => flip("venue")}>
            <div className="chip-row">
              {Object.entries(VENUE_TYPES).map(([id, label]) => (
                <Chip key={id} pressed={draft.venueTypes.includes(id)} onClick={() => set({ venueTypes: toggle(draft.venueTypes, id) })}>
                  {label}
                </Chip>
              ))}
            </div>
          </Disclosure>
        </div>

        <div className="filter-actions">
          <Button type="button" variant="ghost" onClick={() => setDraft(cleared)} disabled={!dirty}>
            Clear all
          </Button>
          <Button type="submit" variant="primary" size="lg" aria-live="polite">
            {n === 0 ? "No events match" : `Show ${n} event${n === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
