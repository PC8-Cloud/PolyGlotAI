# PRODUCT REQUIREMENTS DOCUMENT

---

# VoceTraduci

**Real-Time Multilingual Voice Translation Platform**
Web App + Mobile (iOS / Android)

**Versione:** 1.0
**Data:** Marzo 2026
**Classificazione:** Confidenziale

---

## 1. Executive Summary

VoceTraduci è una piattaforma di traduzione vocale simultanea in tempo reale, progettata per abbattere le barriere linguistiche in contesti professionali, turistici, educativi e sociali. L'applicazione consente a un oratore di parlare nella propria lingua mentre tutti i partecipanti collegati ricevono la traduzione audio nella lingua da loro selezionata, in tempo reale.

La piattaforma sarà disponibile come Web App progressiva (PWA) e successivamente come app nativa per iOS e Android. L'intero stack di traduzione si basa sulle API di OpenAI (Whisper per STT, GPT-4o per traduzione contestuale, TTS per sintesi vocale). L'interfaccia utente si ispira ai dispositivi Vasco Translator per semplicità, immediatezza e design premium.

---

## 2. Vision e Obiettivi Strategici

### 2.1 Vision

Rendere la comunicazione multilingue istantanea, accessibile e naturale come parlare nella propria lingua madre, senza dispositivi dedicati: basta uno smartphone o un browser.

### 2.2 Obiettivi di Business

1. Acquisire 10.000 utenti attivi entro 6 mesi dal lancio.
2. Raggiungere un tasso di retention settimanale del 40% entro il primo trimestre.
3. Supportare almeno 40 lingue al lancio con latenza percepita inferiore a 2 secondi.
4. Generare revenue tramite modello freemium con abbonamenti Pro ed Enterprise.

### 2.3 Metriche di Successo (KPI)

| KPI | Target MVP | Target 12 Mesi |
|-----|-----------|-----------------|
| Latenza end-to-end | < 3 secondi | < 1.5 secondi |
| Accuratezza traduzione (BLEU) | > 0.70 | > 0.85 |
| Utenti attivi mensili (MAU) | 2.000 | 50.000 |
| Sessioni concorrenti supportate | 500 | 10.000 |
| NPS (Net Promoter Score) | > 40 | > 60 |

---

## 3. Utenti Target e Personas

### 3.1 Persona Primaria: Il Relatore Internazionale

- **Nome:** Marco, 45 anni — Manager di una PMI italiana
- **Contesto:** Partecipa a fiere internazionali e tiene presentazioni a gruppi multilingue.
- **Frustrazione:** Gli interpreti simultanei costano 800–1.500€/giorno. I traduttori automatici non gestiscono il contesto tecnico.
- **Obiettivo:** Parlare in italiano e far sentire la traduzione live a 50 persone in 5 lingue diverse.

### 3.2 Persona Secondaria: Il Turista

- **Nome:** Yuki, 28 anni — Turista giapponese in Europa
- **Contesto:** Viaggia in paesi dove non parla la lingua locale.
- **Frustrazione:** I traduttori portatili hanno vocabolario limitato e richiedono connessione stabile.
- **Obiettivo:** Comunicazione bidirezionale fluida con un interlocutore in modalità 1:1.

### 3.3 Persona Terziaria: L'Educatore

- **Nome:** Anna, 38 anni — Docente universitaria con studenti Erasmus
- **Contesto:** Classe con studenti di 8 nazionalità diverse.
- **Obiettivo:** Tenere lezione in italiano mentre ogni studente segue nella propria lingua.

---

## 4. Modalità Operative dell'Applicazione

L'app prevede tre modalità operative principali, selezionabili dalla schermata home attraverso un'interfaccia a card ispirata ai device Vasco.

### 4.1 Modalità Conversazione 1:1

**Caso d'uso:** Due persone che parlano lingue diverse si trovano faccia a faccia. L'app funziona come un interprete tascabile.

**Flusso UX:** La schermata è divisa verticalmente in due metà. Ciascun interlocutore seleziona la propria lingua e preme il pulsante microfono nella propria area per parlare. Il testo originale e la traduzione appaiono in tempo reale in entrambe le aree. La sintesi vocale riproduce la traduzione automaticamente.

**Caratteristiche chiave:**

- Split-screen con orientamento reversibile (landscape/portrait)
- Rilevamento automatico della lingua opzionale
- Cronologia della conversazione con possibilità di export
- Indicatore visivo di ascolto/elaborazione/riproduzione

### 4.2 Modalità Megafono Tradotto

**Caso d'uso:** Un oratore deve comunicare un messaggio a un gruppo di persone che parlano lingue diverse. Funziona come un megafono multilingue.

**Flusso UX — Lato Oratore:** L'oratore crea una "Stanza" e seleziona la propria lingua. Viene generato un codice stanza e un QR code. L'oratore preme un grande pulsante centrale per parlare (stile walkie-talkie). L'interfaccia mostra il testo trascritto in tempo reale e il numero di partecipanti connessi per lingua.

**Flusso UX — Lato Ascoltatore:** Il partecipante scansiona il QR code o inserisce il codice stanza. Seleziona la lingua di ascolto preferita. L'audio tradotto viene riprodotto automaticamente in tempo reale. Il testo tradotto appare su schermo come sottotitoli live. L'interfaccia mostra anche il testo originale in una sezione ridotta.

**Caratteristiche chiave:**

- Supporto fino a 500 ascoltatori per stanza
- Nessuna registrazione richiesta per gli ascoltatori (accesso via link/QR)
- Selezione lingua con bandierine e ricerca
- Volume e velocità voce regolabili lato ascoltatore
- Possibilità di pausa e riproduzione ultimo segmento

### 4.3 Modalità Conferenza Interattiva (Q&A)

**Caso d'uso:** Estensione della modalità Megafono che aggiunge l'interattività: i partecipanti possono fare domande nella loro lingua e l'oratore le riceve tradotte.

**Flusso UX — Lato Oratore:** L'oratore attiva la modalità Q&A dalla dashboard. Appare una coda domande ordinata cronologicamente. Ogni domanda mostra: testo originale, lingua di origine, traduzione nella lingua dell'oratore, nome o ID del partecipante. L'oratore seleziona una domanda e risponde vocalmente; la risposta viene tradotta e inviata a tutti.

**Flusso UX — Lato Partecipante:** Il partecipante preme un pulsante "Alza la mano / Fai una domanda". Si attiva il microfono per registrare la domanda nella propria lingua. La domanda entra nella coda dell'oratore. Il partecipante riceve notifica quando la domanda è stata letta e quando viene data la risposta.

**Caratteristiche chiave:**

- Coda domande con sistema di priorità
- Moderazione opzionale (approvazione domande prima dell'inoltro)
- Risposta broadcast tradotta in tutte le lingue dei partecipanti
- Possibilità di domande testuali oltre che vocali
- Indicatore "in attesa/risposta" per il partecipante

---

## 5. Architettura Tecnica

### 5.1 Stack Tecnologico

| Livello | Tecnologia |
|---------|-----------|
| Frontend Web | React 19 + TypeScript + Tailwind CSS (PWA con Service Worker) |
| Mobile | React Native (iOS + Android) con condivisione logica core |
| Backend API | Node.js (Express/Fastify) oppure Python (FastAPI) |
| Real-time | WebSocket (Socket.IO) + WebRTC per streaming audio peer-to-peer |
| STT (Speech-to-Text) | OpenAI Whisper API (modello large-v3) con streaming chunked |
| Traduzione | OpenAI GPT-4o con prompt contestuale e glossario personalizzabile |
| TTS (Text-to-Speech) | OpenAI TTS API (voci: alloy, echo, fable, onyx, nova, shimmer) |
| Database | PostgreSQL (utenti, sessioni) + Redis (cache, code real-time) |
| Infrastruttura | AWS / GCP con auto-scaling, CDN CloudFront, container Docker/K8s |
| Autenticazione | Firebase Auth (Google, Apple, Email) + JWT |

### 5.2 Pipeline di Traduzione in Tempo Reale

Il flusso di elaborazione segue questa pipeline ottimizzata per minimizzare la latenza:

1. **Cattura Audio:** il browser/app cattura l'audio tramite Web Audio API / MediaRecorder con chunk di 500ms.
2. **Streaming a Backend:** i chunk audio vengono inviati via WebSocket al server in formato PCM16/Opus.
3. **STT (Whisper):** il server invia i chunk a OpenAI Whisper API; la trascrizione parziale viene emessa in streaming.
4. **Traduzione (GPT-4o):** il testo trascritto viene inviato a GPT-4o con contesto della conversazione (ultimi 5 turni) per traduzione contestuale. Risposta in streaming.
5. **TTS (OpenAI TTS):** il testo tradotto viene convertito in audio tramite OpenAI TTS API con la voce selezionata.
6. **Distribuzione:** l'audio sintetizzato e il testo vengono distribuiti a tutti i client collegati alla stanza via WebSocket.

### 5.3 Ottimizzazione Latenza

- **Sentence-level chunking:** la traduzione parte non appena una frase completa viene rilevata, senza attendere la fine del turno.
- **Pipeline parallela:** STT, traduzione e TTS operano in parallelo su frasi consecutive (mentre la frase 2 viene trascritta, la frase 1 viene già tradotta).
- **Cache semantica:** traduzioni di frasi ricorrenti (es. saluti, formule di cortesia) vengono memorizzate per risposta istantanea.
- **Edge computing:** server di prossimità in regioni chiave (EU, US, Asia) per ridurre la latenza di rete.
- **OpenAI Realtime API:** valutazione dell'utilizzo della Realtime API di OpenAI per STT+traduzione+TTS in un singolo flusso bidirezionale.

---

## 6. Design dell'Interfaccia (Stile Vasco)

L'interfaccia si ispira al design dei traduttori Vasco per ottenere un look premium, intuitivo e orientato all'azione.

### 6.1 Principi di Design

- **Minimalismo funzionale:** un'azione per schermata. L'utente non deve mai chiedersi "cosa devo fare ora?".
- **Pulsante centrale dominante:** il microfono è sempre l'elemento più grande e visibile sullo schermo.
- **Feedback visivo costante:** animazioni fluide per stati di ascolto, elaborazione, traduzione e riproduzione.
- **Selezione lingua con bandierine:** icone bandiera grandi e facilmente riconoscibili, con ricerca testuale.
- **Dark mode come default:** sfondo scuro con testi ad alto contrasto per leggibilità in ogni ambiente.
- **Tipografia chiara:** font sans-serif grande, peso bold per testo tradotto, regular per originale.

### 6.2 Schermate Principali

| Schermata | Descrizione |
|-----------|------------|
| Home | 3 card grandi per selezione modalità (1:1, Megafono, Conferenza Q&A). Animazioni su hover/tap. Logo in alto, profilo utente in alto a destra. |
| Conversazione 1:1 | Split-screen verticale con selettori lingua e pulsanti microfono per ciascun interlocutore. Area testo con scroll per cronologia. Indicatore stato. |
| Megafono — Oratore | Pulsante microfono gigante al centro. In alto: QR code e codice stanza. In basso: testo trascritto live e contatore partecipanti per lingua. |
| Megafono — Ascoltatore | Area sottotitoli a schermo pieno con testo grande. Selettore lingua in alto. Controlli volume e velocità voce in basso. Pulsante "Alza la mano" se Q&A attivo. |
| Q&A Dashboard | Lista domande con card: lingua di origine (bandierina), testo originale, traduzione, timestamp. Pulsante "Rispondi" per ciascuna domanda. |
| Impostazioni | Voce TTS preferita, velocità parlato, tema (dark/light), glossario personalizzato, gestione account, abbonamento. |
| Join Stanza | Input codice stanza + scanner QR code. Selezione lingua di ascolto con griglia bandierine. Pulsante "Entra" grande. |

### 6.3 Design System

- **Palette colori:** sfondo primario `#0D1117` (dark), accento blu `#1A73E8`, accento arancione `#FF6D00` (pulsanti azione), testo bianco `#FFFFFF`, testo secondario `#8B949E`.
- **Tipografia:** titoli in SF Pro Display / Google Sans Bold; corpo testo in Inter / Roboto Regular; testo tradotto sempre più grande del testo originale.
- **Componenti:** card con border-radius 16px, ombre morbide (`box-shadow: 0 4px 24px rgba(0,0,0,0.3)`), pulsanti con micro-animazioni (scale + glow), transizioni 300ms ease.
- **Icone:** set custom minimale + bandierine SVG ad alta risoluzione per tutte le lingue supportate.
- **Animazioni microfono:** cerchio pulsante blu durante l'ascolto, spinner durante l'elaborazione, onda audio durante la riproduzione.

---

## 7. Lingue Supportate

Al lancio MVP, VoceTraduci supporterà le seguenti 40+ lingue, suddivise per priorità.

### 7.1 Tier 1 — Lancio MVP (20 lingue)

Italiano, Inglese (US/UK), Spagnolo, Francese, Tedesco, Portoghese (BR/PT), Cinese Mandarino, Giapponese, Coreano, Arabo, Russo, Hindi, Turco, Polacco, Olandese, Svedese, Danese, Norvegese, Finlandese, Greco.

### 7.2 Tier 2 — Fase 2 (20+ lingue addizionali)

Thailandese, Vietnamita, Indonesiano, Malese, Tagalog, Ucraino, Ceco, Rumeno, Ungherese, Bulgaro, Croato, Slovacco, Sloveno, Ebraico, Persiano, Urdu, Bengali, Tamil, Swahili, Catalano.

---

## 8. Integrazione API OpenAI — Dettaglio

### 8.1 Whisper API (Speech-to-Text)

- **Endpoint:** `POST /v1/audio/transcriptions`
- **Modello:** whisper-1 (large-v3)
- **Formato input:** audio chunk in formato webm/opus o mp3 (chunk di 2–5 secondi)
- **Parametri:** `language` (opzionale, per forzare lingua), `response_format: verbose_json` (per timestamp), `prompt` (contesto precedente per continuità)
- **Strategia:** invio chunk sovrapposti (overlapping) per evitare taglio a metà parola; ricostruzione lato server.

### 8.2 GPT-4o (Traduzione Contestuale)

1. **Endpoint:** `POST /v1/chat/completions` (con `stream: true`)
2. **System prompt** dedicato alla traduzione che include: istruzioni per traduzione naturale (non letterale), contesto degli ultimi 5 turni della conversazione, glossario personalizzato dell'utente, indicazione del registro (formale/informale).
3. **Ottimizzazione token:** utilizzo di `max_tokens` ridotto, `temperature 0.3` per coerenza, presenza di few-shot examples nel prompt per coppie linguistiche comuni.

### 8.3 TTS API (Text-to-Speech)

1. **Endpoint:** `POST /v1/audio/speech`
2. **Modello:** `tts-1` (bassa latenza) per real-time; `tts-1-hd` per download/export.
3. **Voci disponibili:** alloy, echo, fable, onyx, nova, shimmer — mappate per preferenza genere/tonalità.
4. **Formato output:** opus (per streaming real-time, bassa latenza) o mp3 (per export).
5. **Speed:** parametro `speed` (0.25–4.0) esposto all'utente per regolazione velocità.

### 8.4 Realtime API (Opzione Avanzata)

OpenAI offre la Realtime API che combina STT + LLM + TTS in un singolo flusso bidirezionale WebSocket. Questa opzione verrà valutata per la versione 2.0 in quanto offre latenza significativamente ridotta (~500ms end-to-end) ma con costi più elevati e minor controllo granulare sulle singole fasi della pipeline.

---

## 9. Sicurezza e Privacy

1. **GDPR Compliance:** tutti i dati vocali vengono elaborati in tempo reale e non vengono mai salvati permanentemente (processing only, zero-retention).
2. **Crittografia:** TLS 1.3 per tutte le comunicazioni client-server; DTLS per canali WebRTC.
3. **Autenticazione:** OAuth 2.0 via Firebase Auth; JWT con scadenza breve (15 min) e refresh token sicuro.
4. **API Key Management:** le chiavi OpenAI sono conservate lato server (mai esposte al client); rotazione trimestrale.
5. **Rate Limiting:** protezione anti-abuse con limiti per utente e per stanza; sistema anti-DDoS su CDN.
6. **Consent Management:** banner consenso audio con opt-in esplicito; informativa privacy multilingue.

---

## 10. Modello di Monetizzazione

| Funzionalità | Free | Pro (€9.99/mese) | Enterprise (custom) |
|-------------|------|-------------------|---------------------|
| Conversazione 1:1 | 15 min/giorno | Illimitata | Illimitata |
| Megafono | 5 min, max 10 pers. | Illimitato, max 100 | Illimitato, max 500+ |
| Conferenza Q&A | Non disponibile | Disponibile | Disponibile + analytics |
| Lingue | 10 lingue base | 40+ lingue | 40+ lingue + custom |
| Glossario custom | No | Sì (500 termini) | Sì (illimitato) |
| Voce TTS HD | Standard | HD | HD + voci custom |
| Supporto | Community | Email prioritaria | Dedicato + SLA |

---

## 11. Roadmap di Sviluppo

| Fase | Timeline | Deliverable |
|------|---------|------------|
| Fase 0 — Discovery | Mese 1 | Validazione tecnica API OpenAI, benchmark latenza, wireframe UX, test con 5 utenti. |
| Fase 1 — MVP | Mesi 2–4 | Web app PWA con modalità 1:1 e Megafono. 20 lingue Tier 1. Autenticazione base. Landing page. |
| Fase 2 — Beta | Mesi 5–6 | Modalità Conferenza Q&A. App React Native (iOS/Android). Glossario custom. Piano Pro attivo. |
| Fase 3 — Lancio | Mese 7 | 40+ lingue. Ottimizzazione latenza sub-2s. Marketing launch. App Store e Play Store. |
| Fase 4 — Scale | Mesi 8–12 | Enterprise plan. Realtime API. Offline mode parziale. Integrazioni (Zoom, Teams, Meet). SDK per terze parti. |

---

## 12. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|------------|---------|-------------|
| Latenza troppo alta per real-time fluido | Media | Alto | Pipeline parallela, edge computing, valutazione Realtime API, caching aggressivo. |
| Costi API OpenAI non sostenibili | Alta | Alto | Limiti free tier, caching, batch processing, negoziazione volume discount con OpenAI. |
| Qualità traduzione insufficiente per lingue rare | Media | Medio | Glossari custom, prompt engineering specifico, feedback loop utenti per miglioramento continuo. |
| Cambio pricing/policy API OpenAI | Media | Alto | Architettura modulare per swap provider (es. Google Cloud STT/TTS, DeepL). Astrazione API layer. |
| Problemi GDPR con dati vocali | Bassa | Alto | Zero-retention policy, DPA con OpenAI, server EU, audit periodici, consulenza legale dedicata. |
| Scalabilità WebSocket sotto carico | Media | Medio | Load balancing con sticky sessions, infrastruttura auto-scaling, stress testing pre-lancio. |

---

## 13. Team e Risorse Necessarie

| Ruolo | FTE | Responsabilità Principali |
|-------|-----|--------------------------|
| Product Manager | 1 | Ownership PRD, prioritizzazione backlog, stakeholder management |
| Frontend Engineer (React/RN) | 2 | Web app PWA, app React Native, UI/UX implementation |
| Backend Engineer | 2 | API server, WebSocket, integrazione OpenAI, infrastruttura |
| UI/UX Designer | 1 | Design system, wireframe, prototipi, user testing |
| DevOps / SRE | 1 | CI/CD, monitoring, auto-scaling, sicurezza infrastruttura |
| QA Engineer | 1 | Testing E2E, performance testing, test multilingue |

**Team totale stimato:** 8 FTE per la Fase 1–2, scalabile a 12 per Fase 3–4.

---

## 14. Appendice — Stima Costi API OpenAI

Stima basata sui prezzi OpenAI di Marzo 2026, calcolata per sessione media di 10 minuti:

| Servizio | Costo Unitario | Consumo/Sessione | Costo/Sessione |
|----------|---------------|------------------|----------------|
| Whisper STT | $0.006/min | ~10 min audio | ~$0.06 |
| GPT-4o Traduzione | $2.50/1M input tok | ~2.000 token | ~$0.005 |
| TTS | $15/1M caratteri | ~1.500 caratteri | ~$0.023 |
| **TOTALE per sessione** | | | **~$0.09** |

> **Nota:** nella modalità Megafono, il costo TTS si moltiplica per il numero di lingue target uniche (non per il numero di ascoltatori, poiché l'audio generato per una lingua viene distribuito a tutti gli ascoltatori di quella lingua). Per una sessione Megafono con 5 lingue target: ~$0.06 (STT) + $0.025 (traduzione ×5) + $0.115 (TTS ×5) = **~$0.20/sessione**.

---

*Fine del Documento — VoceTraduci PRD v1.0*
