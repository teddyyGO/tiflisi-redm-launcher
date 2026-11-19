# Privacy policy

Tiflisi Launcher is a free, open-source launcher for RedM. This page lists everything it sends over the network and how to turn off the part you don't need. It applies to the launcher built from this repository. [ქართული ვერსია ქვემოთაა.](#კონფიდენციალურობის-პოლიტიკა)

## What the launcher sends, and where

| When | Sent to | What |
|---|---|---|
| You open Home or the Servers tab | Cfx.re's server list (`frontend.cfx-services.net`) | A normal request for the server list and server details |
| A server is shown on screen | That server's own address | Requests for its public status (players, ping) |
| A server's picture is shown | Wherever that server's owner hosts it | A normal image request |
| At start, every 10 minutes and when the window comes back | GitHub (`github.com`) | A check for a new version, and the download if there is one |
| You press Join | The server you join, if it runs the `launcher_check` resource | The launcher version. Server staff use it to see who joined with the launcher, for example for a one-time reward |
| Every minute while the launcher is open, if "Share anonymous launcher stats" is on | The featured server (Tiflisi 1898) | A random install number, the launcher version, its language, and whether RedM is running |

The random install number is made on your PC the first time the launcher starts. It is not linked to your name or to any account. Delete the `launcher-id` file in the launcher's data folder and you get a new one.

Like any website, each of these services sees your IP address.

The launcher never sends your name, your in-game name, your Rockstar, Cfx.re or Discord account, your files, or details about your PC.

## Turning it off

- **Anonymous stats:** Settings → "Share anonymous launcher stats". When it's off, nothing is sent every minute. The installer shows this policy before installing.
- **Whole launcher:** server owners who build their own launcher can turn the stats off for everyone with `"usageStats": false` in `config.json`.
- The Join message and the update check are part of joining and updating. If you start RedM yourself instead of using the launcher, neither is sent.

## What stays on your PC

- Settings, favorite servers and the install number: `%APPDATA%\open-redm-launcher`.
- Your name in game: written into RedM's own settings file (`%APPDATA%\CitizenFX\redm.cfg`). The launcher doesn't send it anywhere.
- On first start, if RedM's join links are broken, the launcher repairs them (the same Windows entry RedM writes itself) and says so on the welcome card. Everything else in Tools changes something only when you use it, and switching the game version asks first.

## Other services

The services above have their own privacy policies: Cfx.re (part of Rockstar Games), [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), and the servers you play on.

## Questions

Open an issue: <https://github.com/teddyyGO/tiflisi-redm-launcher/issues>

Last changed: 20 November 2026.

---

# კონფიდენციალურობის პოლიტიკა

Tiflisi Launcher უფასო, ღია კოდის ლაუნჩერია RedM-ისთვის. აქ ჩამოთვლილია ყველაფერი, რასაც ის ინტერნეტით აგზავნის, და როგორ გამორთოთ ის, რაც არ გჭირდებათ.

## რას აგზავნის ლაუნჩერი და სად

- **სერვერების სია:** Cfx.re-ის სერვერების სიიდან (`frontend.cfx-services.net`), ჩვეულებრივი მოთხოვნით.
- **სერვერის სტატუსი:** ეკრანზე ნაჩვენები სერვერის საკუთარ მისამართზე (მოთამაშეები, პინგი).
- **სერვერის სურათები:** იქიდან, სადაც სერვერის მფლობელი ინახავს მათ.
- **განახლებები:** GitHub-ზე (`github.com`) ახალი ვერსიის შემოწმება და ჩამოტვირთვა.
- **შესვლისას:** სერვერს, რომელზეც შედიხართ (თუ მასზე `launcher_check` მუშაობს), ეგზავნება ლაუნჩერის ვერსია. სერვერის ადმინისტრაცია ხედავს, ვინ შევიდა ლაუნჩერით, მაგალითად ერთჯერადი ბონუსისთვის.
- **ანონიმური სტატისტიკა** (თუ ჩართულია): სანამ ლაუნჩერი ღიაა, ყოველ წუთში რჩეულ სერვერს (Tiflisi 1898) ეგზავნება შემთხვევითი ინსტალაციის ნომერი, ლაუნჩერის ვერსია, მისი ენა და ჩართულია თუ არა RedM.

შემთხვევითი ინსტალაციის ნომერი თქვენს კომპიუტერზე იქმნება ლაუნჩერის პირველი გაშვებისას. ის არ არის დაკავშირებული თქვენს სახელთან ან რომელიმე ანგარიშთან.

როგორც ნებისმიერი ვებსაიტი, თითოეული ეს სერვისი ხედავს თქვენს IP მისამართს.

ლაუნჩერი არასოდეს აგზავნის თქვენს სახელს, თამაშის სახელს, Rockstar-ის, Cfx.re-ის ან Discord-ის ანგარიშს, თქვენს ფაილებს ან კომპიუტერის მონაცემებს.

## როგორ გამოვრთოთ

- **ანონიმური სტატისტიკა:** პარამეტრები → „ანონიმური სტატისტიკის გაზიარება“. გამორთვის შემდეგ ყოველწუთიერად აღარაფერი იგზავნება. ინსტალერი ამ პოლიტიკას ინსტალაციამდე აჩვენებს.
- შესვლის შეტყობინება და განახლების შემოწმება შესვლისა და განახლების ნაწილია. თუ RedM-ს თავად გაუშვებთ, არცერთი არ იგზავნება.

## რა რჩება თქვენს კომპიუტერზე

- პარამეტრები, რჩეული სერვერები და ინსტალაციის ნომერი: `%APPDATA%\open-redm-launcher`.
- თამაშის სახელი იწერება RedM-ის საკუთარ პარამეტრების ფაილში (`%APPDATA%\CitizenFX\redm.cfg`). ლაუნჩერი მას არსად აგზავნის.
- პირველი გაშვებისას, თუ RedM-ის შესვლის ბმულები გაფუჭებულია, ლაუნჩერი აღადგენს მათ და ამას მისასალმებელ ბარათზე წერს. ხელსაწყოები დანარჩენს მხოლოდ მაშინ ცვლის, როცა თავად იყენებთ, ხოლო თამაშის ვერსიის შეცვლამდე გეკითხებათ.

## კითხვები

<https://github.com/teddyyGO/tiflisi-redm-launcher/issues>
