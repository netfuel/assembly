import { useEffect, useState } from "react";
import { Button, Chip, Label, Segmented, Sheet } from "../components/ui";
import { POLICY_TAGS, SCENES, VENUE_TYPES, type SceneId } from "../../shared/types";
import { DEFAULT_FILTERS, PRESETS, PRICES, activeCount, type Filters, type PriceId } from "../lib/filters";
import { dateHeading, tonightDate, type WindowId } from "../lib/time";

const WHEN: { id: WindowId; label: string }[] = [
  { id: "tonight", label: "Tonight" },
  { id: "weekend", label: "Weekend" },
  { id: "week", label: "7 days" },
  { id: "all", label: "All" },
  { id: "date", label: "Date" },
];

// Door policies people filter on. "No photos" and BYOB are info, not something to search by.
const POLICY_FILTERS = ["all-ages", "18+", "21+", "sliding-scale", "accessible-entrance", "sober-friendly", "harm-reduction"];

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const same = (a: Filters, b: Partial<Filters>) =>
  (Object.keys(b) as (keyof Filters)[]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/**
 * Every filter in one sheet: when, scene, door policy, price, venue type. Changes are a draft until Apply,
 * which shows how many events match. Bottom sheet on phones (swipe down to close), side panel on wide screens.
 */
export function FilterSheet({
  open,
  onClose,
  filters,
  tz,
  count,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  tz: string;
  count: (f: Filters) => number;
  onApply: (f: Filters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  // Start each visit from what's applied now.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const n = count(draft);
  const today = tonightDate(new Date(), tz);

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

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">When</legend>
          <Segmented
            label="When"
            options={WHEN.map((w) => ({ id: w.id, label: w.id === "date" && draft.windowId === "date" && draft.date ? dateHeading(draft.date) : w.label }))}
            value={draft.windowId}
            onChange={(id) => set({ windowId: id, date: id === "date" ? (draft.date ?? today) : draft.date })}
          />
          {draft.windowId === "date" && (
            <label className="field filter-date">
              <span className="field-label">Date</span>
              <input type="date" value={draft.date ?? today} min={today} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </label>
          )}
        </fieldset>

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

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">Door</legend>
          <div className="chip-row">
            {POLICY_FILTERS.map((id) => (
              <Chip key={id} pressed={draft.policies.includes(id)} onClick={() => set({ policies: toggle(draft.policies, id) })}>
                {POLICY_TAGS[id]}
              </Chip>
            ))}
          </div>
          <p className="note">All of these.</p>
        </fieldset>

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">Price</legend>
          <Segmented label="Price" options={PRICES} value={draft.price} onChange={(price: PriceId) => set({ price })} />
          {draft.price !== "any" && <p className="note">Events without a listed price are left out.</p>}
        </fieldset>

        <fieldset className="filter-group" data-reveal>
          <legend className="field-label">Venue</legend>
          <div className="chip-row">
            {Object.entries(VENUE_TYPES).map(([id, label]) => (
              <Chip key={id} pressed={draft.venueTypes.includes(id)} onClick={() => set({ venueTypes: toggle(draft.venueTypes, id) })}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <div className="filter-actions">
          <Button type="button" variant="ghost" onClick={() => setDraft({ ...DEFAULT_FILTERS, date: draft.date })} disabled={activeCount(draft) === 0}>
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

/** The filters that are on, as chips under the Filters button. Tap one to remove it. Nothing shows by default. */
export function FilterChips({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const chips: { key: string; label: string; remove: Partial<Filters> }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, remove: { q: null } });
  if (filters.windowId !== "tonight") {
    const label = filters.windowId === "date" && filters.date ? dateHeading(filters.date) : WHEN.find((w) => w.id === filters.windowId)!.label;
    chips.push({ key: "when", label, remove: { windowId: "tonight" } });
  }
  for (const s of filters.scenes)
    chips.push({ key: `s-${s}`, label: SCENES.find((x) => x.id === s)!.label, remove: { scenes: filters.scenes.filter((x) => x !== s) } });
  for (const p of filters.policies) chips.push({ key: `p-${p}`, label: POLICY_TAGS[p], remove: { policies: filters.policies.filter((x) => x !== p) } });
  if (filters.price !== "any") chips.push({ key: "price", label: PRICES.find((p) => p.id === filters.price)!.label, remove: { price: "any" } });
  for (const v of filters.venueTypes) chips.push({ key: `v-${v}`, label: VENUE_TYPES[v], remove: { venueTypes: filters.venueTypes.filter((x) => x !== v) } });
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <button key={c.key} type="button" className="chip chip-remove" aria-label={`Remove filter: ${c.label}`} onClick={() => onChange({ ...filters, ...c.remove })}>
          {c.key === "s-queer" && <span className="marker" style={{ background: "var(--color-uv)" }} aria-hidden="true" />}
          {c.label}
          <span aria-hidden="true" className="chip-x">
            ×
          </span>
        </button>
      ))}
    </>
  );
}
