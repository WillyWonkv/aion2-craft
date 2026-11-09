# Sito Aion 2 Craft

Questa cartella contiene il sito Cloudflare Pages:

- `public/`: pagina, JavaScript, stili e dati ricette;
- `functions/`: API Pages per server, ricette e prezzi.

In Cloudflare Pages imposta **Root directory** su `site` e **Build output directory** su `public`. Per l'avvio locale usa `Aion2-Craft.cmd` dalla radice del repository oppure esegui `npm start` da questa cartella.

Prima di pubblicare il login, aggiungi due segreti al progetto Pages in **Settings → Variables and Secrets**:

- `SITE_PASSWORD`: password condivisa, fino a 256 caratteri.
- `SITE_SESSION_SECRET`: un valore casuale distinto di almeno 32 caratteri, riservato al server.

Mantieni il binding D1 `PRICE_HISTORY`. Il login crea la tabella `site_login_attempts` quando serve. In **Settings → Runtime → Fail open / closed**, seleziona **Fail closed** perché il sito resti protetto se la quota delle Functions si esaurisce. Configura anche l'ambiente Preview se vuoi usare gli URL di anteprima. Pubblica il progetto dopo aver salvato le impostazioni.

Il cookie si rinnova con l'uso e scade dopo 30 giorni di inattività. Cambiare la password o la chiave di sessione invalida i cookie esistenti. Il launcher e il server locale sono accessibili solo via loopback e non usano il login Pages.
