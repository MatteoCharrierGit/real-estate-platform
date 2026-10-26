import type { NotificationEvent } from "../../shared/sns";

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const BRAND = "Piattaforma Immobiliare";

const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Testo libero dell'utente (titolo dell'immobile) -> riga sicura per l'oggetto: niente a capo né caratteri di controllo. */
export function oneLine(s: string, max = 80): string {
  const t = s.replace(/[\u0000-\u001f\u007f]|[\u2028\u2029]/g, " ").replace(/ {2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Valori da `data` con fallback, perché il messaggio arriva da un'altra Lambda e non va dato per scontato. */
function facts(data: Record<string, unknown>) {
  const title = typeof data.propertyTitle === "string" && data.propertyTitle.trim() !== "" ? oneLine(data.propertyTitle, 200) : "un immobile";
  const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? euro(data.amount) : null;
  const propertyId = typeof data.propertyId === "string" && /^[0-9]{1,18}$/.test(data.propertyId) ? data.propertyId : null;
  return { title, amount, propertyId };
}

/** Link nelle email: sempre sotto SITE_URL, con id solo numerici. */
export function links(siteUrl: string, propertyId: string | null) {
  const base = siteUrl.replace(/\/+$/, "");
  return { offers: `${base}/offers`, property: propertyId ? `${base}/properties/${propertyId}` : base };
}

export function render(event: NotificationEvent, siteUrl: string): Rendered {
  const { title, amount, propertyId } = facts(event.data);
  const link = links(siteUrl, propertyId);
  const importo = amount ? ` di ${amount}` : "";

  let subject: string;
  let lines: string[];
  let cta: { label: string; url: string };

  switch (event.type) {
    case "WELCOME":
      subject = `Benvenuto su ${BRAND}`;
      lines = ["Il tuo profilo è stato creato.", "Puoi consultare gli annunci, fare offerte o pubblicare i tuoi immobili, a seconda del tuo ruolo."];
      cta = { label: "Vai al sito", url: link.property };
      break;
    case "OFFER_CREATED":
      subject = `Nuova offerta su «${oneLine(title)}»`;
      lines = [`Hai ricevuto una nuova offerta${importo} sull'immobile «${title}».`, "Puoi accettarla o rifiutarla dalla pagina delle offerte."];
      cta = { label: "Vedi le offerte", url: link.offers };
      break;
    case "OFFER_ACCEPTED":
      subject = `La tua offerta su «${oneLine(title)}» è stata accettata`;
      lines = [`Buone notizie: la tua offerta${importo} sull'immobile «${title}» è stata accettata dal proprietario.`];
      cta = { label: "Vedi le offerte", url: link.offers };
      break;
    case "OFFER_REJECTED":
      subject = `La tua offerta su «${oneLine(title)}» è stata rifiutata`;
      lines = [`La tua offerta${importo} sull'immobile «${title}» è stata rifiutata dal proprietario.`, "Puoi guardare altri annunci o farne una nuova."];
      cta = { label: "Vedi le offerte", url: link.offers };
      break;
    case "OFFER_WITHDRAWN":
      subject = `Offerta ritirata su «${oneLine(title)}»`;
      lines = [`L'offerta${importo} sull'immobile «${title}» è stata ritirata perché l'altra parte ha cancellato il proprio account.`];
      cta = { label: "Vedi le offerte", url: link.offers };
      break;
  }

  const text = `${lines.join("\n\n")}\n\n${cta.label}: ${cta.url}\n\n${BRAND}\n`;
  const html =
    `<!doctype html><html lang="it"><body>` +
    lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") +
    `<p><a href="${escapeHtml(cta.url)}">${escapeHtml(cta.label)}</a></p>` +
    `<p>${escapeHtml(BRAND)}</p></body></html>`;
  return { subject, text, html };
}
