# mtk-licentie

Ondertekende licentiecodes voor MTK-installaties. MTK haalt `licentie.json` elke 6 uur op
en controleert de handtekening zelf. Dit bestand mag openbaar zijn: een code werkt alleen op
de installatie met dat ID en is zonder de geheime sleutel niet te maken of te wijzigen.

- `installaties.json` — welke installaties een code krijgen
- `licentie.json` — de codes (wordt elke week door GitHub Actions bijgewerkt)
- `mtk-licentie.js` — het script dat de codes maakt
- `.github/workflows/verleng.yml` — de wekelijkse verlenging

Zet geen klantnamen of andere gegevens in deze repository.
