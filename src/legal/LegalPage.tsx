import { useEffect } from "react";
import { Label } from "../components/ui";
import { useTheme } from "../lib/theme";
import { CONTACT, DOCS, EFFECTIVE } from "./content";
import "./legal.css";

/** Standalone page for /terms, /privacy, and /guidelines. Doesn't load the map. */
export function LegalPage({ slug }: { slug: keyof typeof DOCS }) {
  const doc = DOCS[slug];
  useTheme(); // applies the saved light or dark theme
  useEffect(() => {
    document.title = `${doc.title} · Assembly`;
  }, [doc.title]);

  return (
    <div className="legal">
      <header className="legal-nav">
        <a className="logo" href="/" aria-label="Assembly home">
          <img src="/icons/favicon.svg" alt="" width="22" height="22" />
          <span className="logo-word">Assembly</span>
        </a>
        <nav aria-label="Policies">
          {(Object.keys(DOCS) as (keyof typeof DOCS)[]).map((k) => (
            <a key={k} href={`/${k}`} aria-current={k === slug ? "page" : undefined}>
              {DOCS[k].title}
            </a>
          ))}
        </nav>
      </header>
      <main className="legal-main">
        <Label glyph="◇">Effective {EFFECTIVE}</Label>
        <h1>{doc.title}</h1>
        <p className="legal-lede">{doc.lede}</p>
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body.map((b, i) =>
              Array.isArray(b) ? (
                <ul key={i}>
                  {b.map((li) => (
                    <li key={li}>{li}</li>
                  ))}
                </ul>
              ) : (
                <p key={i}>{b}</p>
              ),
            )}
          </section>
        ))}
        <footer className="legal-foot">
          <p>
            Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
          <p>
            <a href="/">← Back to the map</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
