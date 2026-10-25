/** Fades out the first-load splash in index.html. Safe to call more than once. */
export function hideSplash() {
  const el = document.getElementById("splash");
  if (!el || el.classList.contains("is-done")) return;
  el.classList.add("is-done");
  setTimeout(() => el.remove(), 400);
}
