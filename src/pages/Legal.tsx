import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ShieldCheck, ScrollText } from "lucide-react";
import { useUserStore } from "../lib/store";

// Bozze legali v1 (da far revisionare a un legale prima del lancio commerciale).
// Testi solo IT/EN: per le altre lingue UI si mostra l'inglese.

const SUPPORT_EMAIL = "polyglot.app2@gmail.com";

function LegalShell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#02114A] text-[#F4F4F4] flex flex-col font-sans">
      <header className="flex items-center gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] border-b border-[#FFFFFF14] bg-[#0E2666]">
        <button onClick={() => navigate(-1)} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
          <ChevronLeft className="w-6 h-6" />
        </button>
        {icon}
        <h1 className="text-lg font-bold">{title}</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
        <div className="text-sm text-[#F4F4F4]/80 leading-relaxed space-y-4 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[#F4F4F4] [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Privacy() {
  const { uiLanguage } = useUserStore();
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");
  return (
    <LegalShell title={isIt ? "Privacy Policy" : "Privacy Policy"} icon={<ShieldCheck className="w-5 h-5 text-[#295BDB]" />}>
      {isIt ? (
        <>
          <p>Ultimo aggiornamento: 6 agosto 2026</p>
          <h2>Titolare del trattamento</h2>
          <p>PC8 S.r.l. (Italia). Contatto: {SUPPORT_EMAIL}</p>
          <h2>Dati trattati</h2>
          <ul>
            <li><strong>Account:</strong> identificativo utente (anche anonimo) e, se accedi con Google, l'email.</li>
            <li><strong>Audio:</strong> la voce registrata durante conversazione, megafono e Auditorium viene inviata ai server di OpenAI per trascrizione, traduzione e sintesi vocale. Non viene conservata da PolyGlotAI dopo l'elaborazione.</li>
            <li><strong>Immagini:</strong> le foto scattate con la funzione fotocamera vengono inviate a OpenAI per l'analisi e non vengono conservate.</li>
            <li><strong>Testi:</strong> i testi tradotti e i messaggi delle stanze Auditorium (conservati finché la stanza esiste).</li>
            <li><strong>Uso e pagamenti:</strong> contatori di utilizzo giornaliero e stato dell'abbonamento (via Stripe; non vediamo i dati della tua carta).</li>
          </ul>
          <h2>Fornitori (responsabili del trattamento)</h2>
          <ul>
            <li>OpenAI (USA) — elaborazione di audio, immagini e testi. I dati inviati via API non vengono usati per addestrare i modelli.</li>
            <li>Google Firebase — autenticazione e database.</li>
            <li>Vercel — hosting dell'applicazione.</li>
            <li>Stripe — pagamenti.</li>
          </ul>
          <p>I trasferimenti extra-UE avvengono sulla base delle Clausole Contrattuali Standard.</p>
          <h2>Finalità e base giuridica</h2>
          <p>I dati sono trattati esclusivamente per fornire il servizio di traduzione (esecuzione del contratto) e per prevenire abusi (legittimo interesse). Nessuna profilazione, nessun marketing.</p>
          <h2>Conservazione</h2>
          <p>L'account e i contatori restano finché l'account esiste. Puoi eliminare l'account in ogni momento da Impostazioni → Elimina account: la cancellazione è immediata e irreversibile.</p>
          <h2>I tuoi diritti</h2>
          <p>Accesso, rettifica, cancellazione, limitazione, portabilità e opposizione scrivendo a {SUPPORT_EMAIL}. Hai diritto di reclamo al Garante per la protezione dei dati personali.</p>
        </>
      ) : (
        <>
          <p>Last updated: August 6, 2026</p>
          <h2>Data controller</h2>
          <p>PC8 S.r.l. (Italy). Contact: {SUPPORT_EMAIL}</p>
          <h2>Data we process</h2>
          <ul>
            <li><strong>Account:</strong> a user identifier (anonymous supported) and, if you sign in with Google, your email.</li>
            <li><strong>Audio:</strong> voice recorded in conversation, megaphone and Auditorium is sent to OpenAI servers for transcription, translation and speech synthesis. PolyGlotAI does not keep it after processing.</li>
            <li><strong>Images:</strong> photos taken with the camera feature are sent to OpenAI for analysis and are not stored.</li>
            <li><strong>Texts:</strong> translated texts and Auditorium room messages (kept for as long as the room exists).</li>
            <li><strong>Usage &amp; billing:</strong> daily usage counters and subscription status (via Stripe; we never see your card details).</li>
          </ul>
          <h2>Processors</h2>
          <ul>
            <li>OpenAI (USA) — processing of audio, images and text. Data sent via the API is not used to train models.</li>
            <li>Google Firebase — authentication and database.</li>
            <li>Vercel — application hosting.</li>
            <li>Stripe — payments.</li>
          </ul>
          <p>Transfers outside the EU rely on Standard Contractual Clauses.</p>
          <h2>Purpose and legal basis</h2>
          <p>Data is processed solely to provide the translation service (contract performance) and to prevent abuse (legitimate interest). No profiling, no marketing.</p>
          <h2>Retention</h2>
          <p>Your account and counters persist while the account exists. You can delete your account at any time from Settings → Delete account: deletion is immediate and irreversible.</p>
          <h2>Your rights</h2>
          <p>Access, rectification, erasure, restriction, portability and objection — write to {SUPPORT_EMAIL}. You may lodge a complaint with your data protection authority.</p>
        </>
      )}
    </LegalShell>
  );
}

export function Terms() {
  const { uiLanguage } = useUserStore();
  const isIt = String(uiLanguage).toLowerCase().startsWith("it");
  return (
    <LegalShell title={isIt ? "Termini di servizio" : "Terms of Service"} icon={<ScrollText className="w-5 h-5 text-[#295BDB]" />}>
      {isIt ? (
        <>
          <p>Ultimo aggiornamento: 6 agosto 2026</p>
          <h2>Il servizio</h2>
          <p>PolyGlotAI è un servizio di traduzione assistita da AI fornito da PC8 S.r.l. Le traduzioni sono generate automaticamente e possono contenere errori: non affidarti a PolyGlotAI per comunicazioni mediche, legali o di emergenza.</p>
          <h2>Account e prova gratuita</h2>
          <p>La prova gratuita dura 5 giorni con limiti giornalieri di utilizzo. I limiti dei piani sono indicati nella pagina dei piani.</p>
          <h2>Abbonamenti e recesso</h2>
          <p>Gli abbonamenti si rinnovano automaticamente e sono gestiti tramite Stripe; puoi disdire in ogni momento dal portale abbonamento, con effetto a fine periodo. Ai sensi dell'art. 59 del Codice del Consumo, richiedendo l'attivazione immediata del servizio digitale acconsenti all'esecuzione immediata e accetti che il diritto di recesso di 14 giorni decada con la piena erogazione; per il rimborso di periodi non goduti scrivi a {SUPPORT_EMAIL}.</p>
          <h2>Uso corretto</h2>
          <p>È vietato l'uso automatizzato o abusivo del servizio (script, scraping, rivendita delle API). I limiti d'uso servono a garantire il servizio a tutti; in caso di abuso l'account può essere sospeso.</p>
          <h2>Responsabilità</h2>
          <p>Il servizio è fornito "così com'è", senza garanzia di disponibilità continua. Nei limiti di legge, la responsabilità di PC8 S.r.l. è limitata all'importo pagato negli ultimi 12 mesi.</p>
          <h2>Legge applicabile</h2>
          <p>Legge italiana. Per i consumatori resta fermo il foro del luogo di residenza.</p>
          <p>Contatto: {SUPPORT_EMAIL}</p>
        </>
      ) : (
        <>
          <p>Last updated: August 6, 2026</p>
          <h2>The service</h2>
          <p>PolyGlotAI is an AI-assisted translation service provided by PC8 S.r.l. (Italy). Translations are machine-generated and may contain errors: do not rely on PolyGlotAI for medical, legal or emergency communication.</p>
          <h2>Account and free trial</h2>
          <p>The free trial lasts 5 days with daily usage limits. Plan limits are listed on the plans page.</p>
          <h2>Subscriptions and withdrawal</h2>
          <p>Subscriptions renew automatically and are handled via Stripe; you can cancel at any time from the billing portal, effective at the end of the period. By requesting immediate activation of the digital service you consent to immediate performance and acknowledge that the 14-day EU withdrawal right lapses once the service is fully provided; for refunds of unused periods write to {SUPPORT_EMAIL}.</p>
          <h2>Fair use</h2>
          <p>Automated or abusive use (scripts, scraping, API resale) is prohibited. Usage limits exist to keep the service available to everyone; abuse may lead to suspension.</p>
          <h2>Liability</h2>
          <p>The service is provided "as is", without guarantee of continuous availability. To the extent permitted by law, PC8 S.r.l.'s liability is limited to the amounts paid in the last 12 months.</p>
          <h2>Governing law</h2>
          <p>Italian law. Consumer forum rights remain unaffected.</p>
          <p>Contact: {SUPPORT_EMAIL}</p>
        </>
      )}
    </LegalShell>
  );
}
