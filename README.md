# Aion 2 Craft

Calcolatore di crafting condivisibile. Selezioni regione e server Global, scegli una ricetta e vedi il costo dei materiali con i prezzi minimi degli annunci del mercato. La scelta del server e gli eventuali prezzi manuali vengono salvati nel browser.

In alto trovi le card dei prezzi rapidi per Wrathful Mind, Wrathful Ego, Wrathful Will, tutte le qualità di Odyle e le Refining Stone. Cambiano con il server selezionato e con **Aggiorna prezzi**.

La sezione **Craft consigliati** confronta il costo del percorso craftato più economico con il ricavo netto dopo la tassa di vendita del 10% e mostra fino a sei armi o armature con margine positivo. Per le ricette combo il costo è quello medio necessario a ottenere un pezzo combo; i fallimenti True/Star Dragon usano le probabilità massime della professione al livello 50. La tariffa di inserzione e il valore dei risultati normali prodotti durante i tentativi non vengono sottratti.

Il campo **Quantità da craftare** indica quanti craft vuoi eseguire. Il programma moltiplica i materiali per quel numero e mostra quante combo sono attese al 25%: per esempio, 20 craft corrispondono in media a 5 attivazioni combo.

Nel dettaglio True/Star Dragon, il costo indicato è quello di **un singolo craft**. Vengono mostrati separatamente prezzo lordo e ricavo netto del risultato normale livello 63 e della combo livello 70. Il ricavo netto usa la tassa di vendita del 10%; i due guadagni sottraggono il costo del craft dal rispettivo ricavo netto. La probabilità della combo resta indicata a parte e non moltiplica questi confronti. L'eventuale tariffa di inserzione, pagata separatamente, non è inclusa perché il suo valore Global non è pubblicato in modo stabile.

## Uso sul tuo PC: un solo file

Condividi `Aion2-Craft.cmd` e aprilo con doppio clic su Windows. Avvia un piccolo server solo sul tuo PC e apre la pagina nel browser. Serve Internet per leggere i prezzi del mercato; non servono Node, npm, Cloudflare o un account. Chiudi la finestra del terminale per fermarlo. Il file HTML aperto da solo non può fare da proxy per l'API dei prezzi.

La cartella sorgente nello ZIP serve per modificare il progetto. Per usarla:

1. Installa **Node.js 20 o successivo**.
2. Estrai lo ZIP in una cartella.
3. Apri il terminale in quella cartella ed esegui `npm start`.
4. Apri **http://localhost:4173** nel browser.

Non serve `npm install`. Il server ascolta solo sul tuo PC (`127.0.0.1`); per leggere i prezzi serve Internet. Le ricette Global sono incluse nel progetto. Per fermarlo, premi `Ctrl+C` nel terminale.

## Pubblicazione facoltativa su Cloudflare Pages

1. Crea un repository GitHub e carica **il contenuto di questa cartella** nella radice del repository.
2. In Cloudflare apri **Workers & Pages → Create application → Pages → Import an existing Git repository** e collega il repository.
3. Imposta **Build command** su `exit 0` e **Build output directory** su `public`.
4. Pubblica. Cloudflare creerà un URL `*.pages.dev` che puoi condividere.

La cartella `functions/api` deve restare alla radice del repository, accanto a `public`. Non basta caricare lo ZIP tramite Direct Upload: Cloudflare non installa le Pages Functions con quel metodo.

Se vuoi condividerlo pubblicamente in futuro, questa opzione resta disponibile.

## Fonti e limiti

- Prezzi: API community di [Aion2Market](https://aion2.exchange/), con il prezzo minimo degli annunci per server. Si aggiornano secondo la disponibilità della fonte e possono differire dal mercato in gioco.
- Ricette iniziali: [xtopolis/aion2-static](https://github.com/xtopolis/aion2-static), estratte dal client **Global** del 21 settembre 2026. Il dataset iniziale conteneva 528 ricette (264 per fazione). Sono state aggiunte le 38 ricette garantite True/Star Dragon introdotte nel Global il 4 novembre 2026, per 566 ricette totali. Gli ID, i materiali, il risultato vincolato e la riuscita garantita sono stati verificati nelle [ricette Global aggiornate](https://aion2.gg/database/recipes) e nelle [note dell'aggiornamento](https://steamcommunity.com/games/3393110/announcements/detail/675136702174461957). Le patch successive possono aggiungere o modificare ricette.
- Per gli oggetti True/Star Dragon di base puoi scegliere la ricetta **Sicuro** (100% di riuscita, oggetto vincolato, nessuna combo) o **Con combo** (può fallire, 25% di attivazione combo dopo il successo). La combo stessa può fallire. Il calcolatore assume la professione al livello massimo 50 e usa automaticamente le probabilità massime: mostra sia le attivazioni combo al 25% sia gli oggetti combo riusciti stimati. [Esempio della ricetta con combo dello Spellbook](https://aion2.gg/database/recipes/true-dragon-lord-spellbook-311053001), [ricetta sicura](https://aion2.gg/database/recipes/true-dragon-lord-spellbook-351053002).
- Crafting normale e Transfer Crafting sono separati. Per il Transfer Crafting il calcolatore include il pezzo precedente della linea craftata, che il dataset non elenca tra i materiali; il gioco può accettare altri pezzi idonei.
- Per i materiali puoi spuntare **Craftato** oppure **Market**. Craftato confronta l'acquisto diretto, le ricette di lavorazione (per esempio Magic Crystal e Orichalcum Ingot) e la trasformazione 1:1 dell'Odyle di pari qualità, scegliendo il costo minore. Market compra direttamente tutti i materiali. Se manca un prezzo per valutare una lavorazione, resta disponibile l'acquisto del materiale. I prodotti della trasformazione sono vincolati.
- I componenti vincolati venduti dal negoziante Global usano prezzi fissi verificati il 7 novembre 2026 nella [lista negozio Global](https://aion2.gaming.tools/shop). Tra questi: Catalyst e Orichalcum Solvent a 400 Kina, gli indurenti Lesser/Intermediate/Superior per le scale e le pelli del drago a 4.650/5.600/6.550 Kina. Il programma include anche martelli, abrasivi, flaconi, inchiostri e tutti gli ingredienti del Cooking Merchant presenti nelle ricette: Sugar e Salt a 220 Kina, Curry Powder, Soy Sauce e Cheese a 440 Kina, Ulmus Oil, Raw Triora Noodles, Abex Butter e i Pepper a 880 Kina. I prezzi manuali prevalgono; quelli del mercato restano specifici del server.
- Trasformazioni Odyle verificate nella [scheda Odyle Global](https://aion2.gaming.tools/items/610610013) e nella [scheda Fresh Aria Global](https://aion2.gaming.tools/items/610670045?variant=630670005). La trasformazione richiede la maestria del gioco; il calcolatore stima il costo ma non controlla il livello del personaggio.
- Il dataset Global non pubblica la tariffa in Kina, quindi non è inclusa. I costi indicano i materiali consumati dal numero di craft scelto; per i True/Star Dragon rischiosi la riuscita è considerata nella stima degli oggetti combo, ma non vengono aggiunti automaticamente altri tentativi. Le tasse di vendita non sono incluse.
- Se il prezzo di un materiale manca, puoi inserirlo a mano. Se una catena di equipaggiamento non è valutabile ma il pezzo precedente è in vendita, il calcolatore usa quel prezzo come ripiego e lo segnala. Altrimenti il totale resta incompleto.
- Nessun account Aion 2, credenziale o accesso al client di gioco è richiesto.

Le icone vengono dal repository di xtopolis. Il file `recipes-global.json` è una normalizzazione del suo dataset MIT; la [licenza originale](https://github.com/xtopolis/aion2-static/blob/main/LICENSE) e la fonte sono indicate qui. `npm run check` verifica la sintassi JavaScript. Questo progetto non è affiliato a NC.
