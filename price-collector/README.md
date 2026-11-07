# Collector prezzi ogni 5 minuti

Il Worker legge i prezzi Aion2Market per gli ID elencati in `SERVER_IDS`, salva uno snapshot compatto in D1 e conserva gli ultimi 30 giorni. La pianificazione `*/5 * * * *` è già in `wrangler.jsonc`. La Function Pages `site/functions/api/history.js` legge lo stesso database; il grafico usa lo storico condiviso quando è configurato e mantiene lo storico locale come ripiego.

## Attivazione Cloudflare

1. Nel dashboard Cloudflare crea un database D1 chiamato `aion2-price-history` e copia il suo `database_id`.
2. Apri `wrangler.jsonc`, sostituisci `SET_D1_DATABASE_ID_HERE` con quell'ID. `SERVER_IDS` è preimpostato a `11303`; verifica che sia l'ID del server che vuoi monitorare. Puoi aggiungere altri ID separati da virgole.
3. Installa Node.js se non è già presente, apri il terminale nella radice del repository ed esegui `npx wrangler login`.
4. Dalla radice del repository esegui `npx wrangler deploy --config price-collector/wrangler.jsonc`. Il deploy registra anche il Cron Trigger ogni 5 minuti.
5. In **Workers & Pages**, apri il progetto Pages del sito e vai in **Settings → Bindings → Add → D1 database**. Imposta il nome variabile esattamente a `PRICE_HISTORY`, scegli `aion2-price-history`, salva e fai un nuovo deploy di Pages.
6. Attendi la prima esecuzione Cron (al massimo 5 minuti), quindi apri **Workers & Pages → aion2-price-collector → Logs** e verifica che la raccolta riporti `ok: true` per il server.

Il Worker crea da solo la tabella `price_snapshots` al primo giro. Le esecuzioni programmate e la sorgente dati non dipendono da una pagina aperta. La quota e la dimensione D1 dipendono dal numero di server configurati e dal volume dei loro annunci.

## Aggiornare il collector

Quando cambi `src/index.js` o `wrangler.jsonc`, ridistribuisci dalla radice con lo stesso comando Wrangler. Il Cron configurato nel file resta la fonte ufficiale della pianificazione.
