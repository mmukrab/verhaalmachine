# De Verhaalmachine

Een klassikaal spel: studenten scannen een QR-code, schrijven per ronde één zin, stemmen op de beste, en zo ontstaat samen één verhaal. Op de beamer verschijnt elke bijdrage als een gekleurde vorm in een 3D-sterrenhemel. Studenten hebben geen account nodig.

- `index.html` is de pagina voor studenten (telefoon).
- `host.html` is de regiepagina voor de docent (beamer).

De pagina's staan op **GitHub Pages**, de live gegevens in **Firebase** (gratis Spark-abonnement).

---

## Eenmalig instellen (ca. 20 minuten)

### 1. Firebase-project maken
1. Ga naar <https://console.firebase.google.com> en log in met een Google-account.
2. **Project toevoegen**, bijvoorbeeld `verhaalmachine`. Google Analytics mag uit.

### 2. Web-app koppelen
1. Klik in het projectoverzicht op het **`</>`-icoon** (Web-app toevoegen). Naam bijv. `verhaalmachine`. Firebase Hosting hoeft **niet** aan.
2. Je ziet een blok `const firebaseConfig = { ... }`. Kopieer de waarden naar **`js/firebase-config.js`**.

### 3. Inloggen aanzetten
1. Ga naar **Build → Authentication → Get started**.
2. Tab **Sign-in method**: zet **Anonymous** aan en zet **Email/Password** aan.
3. Tab **Users → Add user**: vul jouw e-mailadres en een wachtwoord in. Dit is je spelleider-account.
4. Kopieer de **User UID** van die gebruiker (lange code in de lijst).

### 4. Database maken
1. Ga naar **Build → Firestore Database → Create database**.
2. Kies als locatie een **Europese** regio, bijvoorbeeld `eur3 (europe-west)`. Dit kan later niet meer veranderd worden.
3. Kies **Start in production mode**.
4. Open de tab **Rules**, vervang alles door de inhoud van **`firestore.rules`**, en zet in de regel met `VUL_HIER_JOUW_UID_IN` jouw UID uit stap 3.4. Klik **Publish**.

### 5. Op GitHub zetten
1. Maak op GitHub een nieuwe repository, bijv. `verhaalmachine` (Public).
2. **Add file → Upload files** en sleep alle bestanden en mappen (`index.html`, `host.html`, `css/`, `js/`, …) erin. **Commit changes**.
3. **Settings → Pages**: bij *Branch* kies `main` en `/ (root)`, klik **Save**.
4. Na een minuut staat het spel op `https://<jouw-gebruikersnaam>.github.io/verhaalmachine/`.

### 6. GitHub-adres toestaan in Firebase
**Authentication → Settings → Authorized domains → Add domain**: voeg `<jouw-gebruikersnaam>.github.io` toe. Zonder deze stap kan niemand inloggen.

---

## Spelen

1. Open op de beamer-laptop `https://<jouw-gebruikersnaam>.github.io/verhaalmachine/host.html` en log in.
2. Klik **Nieuw spel maken**. Je krijgt een spelcode van 4 tekens en een grote QR-code.
3. Studenten scannen de QR-code, vullen een (bij)naam in en zijn binnen. Hun naam verschijnt op het scherm.
4. Optioneel: **Rondes instellen** (alleen vóór ronde 1): titel aanpassen, een kant-en-klare set kiezen, en per ronde een label en vraag invullen. Rondes toevoegen (max. 12), verwijderen en verschuiven met ↑ ↓.
5. Stuur het spel met de regiebalk: **Start ronde 1 → Naar stemmen → Toon winnaar → Volgende ronde → … → Finale**.
6. In de finale: **Kopieer verhaal** om het eindresultaat te bewaren.

Handig:
- **Volledig scherm** in de regiebalk; **toets H** verbergt de regiebalk (beweeg de muis naar boven om hem terug te halen).
- **Winnaar:** de zin met de meeste stemmen. Bij een gelijkspel (ook als niemand stemt) kiest het spel eerlijk door loting; de andere zinnen met evenveel stemmen staan eronder en je klikt er één aan om die te kiezen. **Andere winnaar** loopt alle zinnen langs.
- **Muziek kiezen** speelt een muziekbestand af via de laptop; **Microfoon** luistert naar muziek in het lokaal (er wordt niets opgenomen of verstuurd). De lichtjes worden groter en feller op de muziek en flitsen op de beat. Een muziekbestand wordt eerst geanalyseerd (tempo, beats en de eerste tel van de maat, zie `js/beats.js`); in de regiebalk zie je dan het BPM. Zonder vast tempo, en bij de microfoon, gebruikt de app live detectie die na een paar maten het tempo vastpakt. Loopt het licht voor of achter op de muziek (bijv. bij een Bluetooth-speaker)? Druk op **[** (eerder) of **]** (later); de laptop onthoudt de instelling.
- **Moderatie:** een woordfilter in de app houdt grove taal tegen (de zin wordt niet verstuurd). Zinnen met een gevoelig woord of de naam van een klasgenoot komen wel binnen maar doen pas mee met stemmen als jij ze toestaat. Via **Zinnen controleren** (met een rood getal als er iets wacht) zie je alle zinnen vervaagd; beweeg erover om te lezen en kies **Toestaan** of **Verbergen**. De woordenlijst staat in `js/moderation.js`.
- In de wachtruimte vormen de lichtjes om de ~12 seconden een andere vorm (banen, ring, dubbele helix, hart, sterrenstelsel, golf, kubus, ster); met muziek wisselt dat op de eerste tel van de maat. **Andere vorm** wisselt direct.
- **Testlichtjes** (0 → 10 → 30 → 100 → 200) zet extra lichtjes op alleen jouw beamer, om te zien hoe het eruitziet met een grote groep. Ze worden niet in het spel opgeslagen en verdwijnen bij herladen.
- **Kleur = toonhoogte:** elke kleurgroep reageert op een eigen deel van de muziek: groen = bas, turquoise = laag, blauw = laag-midden, paars = midden, roze = hoog-midden, rood = hoog, oranje = hoger, geel = sissende klanken (hi-hats); wit reageert op alles. Alleen de bas-kleuren flitsen op de kick. Tijdens muziek staat linksonder een legenda. De indeling staat in `js/space.js` (`FREQ_FAMILIES`).
- **Gloed** (schuifregelaar in de regiebalk, 0–150%): hoe ver de gloed van elk lichtje uitstraalt. Lager zetten als de lichtjes op een felle beamer aan elkaar klonteren; de laptop onthoudt de instelling.
- **Camera draait** (aan/uit): de camera cirkelt langzaam om de lichtjes heen, ook iets op en neer. Bij de uitslag en de finale draait hij vanzelf terug naar voren. De laptop onthoudt de instelling.
- Elke student heeft een eigen kleur. Die zien ze op hun telefoon én in de 3D-weergave.
- Elk **Nieuw spel** krijgt een nieuwe code; oude spellen blijven bewaard.

## Lokaal testen
ES-modules werken niet via `file://`. Start een kleine webserver in deze map, bijv. met de VS Code-extensie *Live Server*, of:

```
npx serve .
```

`localhost` staat standaard al bij de toegestane domeinen in Firebase.

## Privacy (AVG)
- Studenten loggen anoniem in; alleen de (bij)naam die ze zelf invullen en hun zinnen worden opgeslagen.
- Kies in stap 4 een Europese regio.
- Verwijder oude spellen in **Firestore Database → Data** (collectie `games`) als je ze niet meer nodig hebt.
- Raad studenten aan een voornaam of bijnaam te gebruiken.

## Beveiliging
De `firebaseConfig`-gegevens zijn niet geheim; de bescherming zit in `firestore.rules`:
- alleen de spelleider (jouw UID) kan spellen maken en besturen;
- elke student kan alleen de eigen naam, zin en stem schrijven;
- zinnen alleen tijdens de schrijfronde, stemmen alleen tijdens de stemronde, niet op de eigen zin;
- zinnen maximaal 240 tekens, namen maximaal 30.

## Na een wijziging: versienummer ophogen
Browsers bewaren de scripts een tijd. Verhoog na elke wijziging het getal in `?v=…` in `index.html`, `host.html` en de `import`-regels in `js/*.js` (overal hetzelfde getal), anders zien spelers nog de oude versie.
