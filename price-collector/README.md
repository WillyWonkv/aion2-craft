# Collector prezzi ogni minuto

Il Worker legge i prezzi Aion2Market per gli ID elencati in `SERVER_IDS` e salva uno snapshot in D1 ogni minuto. Conserva gli ultimi 7 giorni e usa un indice temporale per rimuovere i record scaduti. I prezzi correnti si aggiornano ogni minuto. La Function Pages `site/functions/api/history.js` legge al massimo uno snapshot per ogni intervallo di 5 minuti, fino a 2.016 campioni in sette giorni. Il grafico mantiene lo storico locale come ripiego.

## Attivazione Cloudflare

1. Nel dashboard Cloudflare crea un database D1 chiamato `aion2-price-history` e copia il suo `database_id`.
2. Apri `wrangler.jsonc` e controlla il database ID. `SERVER_IDS` è impostato a `11303`, il mercato di Vaizel Europa (Elyos). La conservazione è impostata a 7 giorni.
3. Installa Node.js se non è già presente, apri il terminale nella radice del repository ed esegui `npx wrangler login`.
4. Dalla radice del repository esegui `npx wrangler deploy --config price-collector/wrangler.jsonc`. Il deploy registra anche il Cron Trigger ogni minuto.
5. In **Workers & Pages**, apri il progetto Pages del sito e vai in **Settings → Bindings → Add → D1 database**. Imposta il nome variabile esattamente a `PRICE_HISTORY`, scegli `aion2-price-history`, salva e fai un nuovo deploy di Pages.
6. Attendi la prima esecuzione Cron (al massimo un minuto), quindi apri **Workers & Pages → aion2-price-collector → Logs** e verifica che la raccolta riporti `ok: true` per il server.

Il Worker crea da solo la tabella `price_snapshots` al primo giro. Le esecuzioni programmate e la sorgente dati non dipendono da una pagina aperta. La quota e la dimensione D1 dipendono dal numero di server configurati e dal volume dei loro annunci.

## Aggiornare il collector

Quando cambi `src/index.js` o `wrangler.jsonc`, ridistribuisci dalla radice con lo stesso comando Wrangler. Il Cron configurato nel file resta la fonte ufficiale della pianificazione.
