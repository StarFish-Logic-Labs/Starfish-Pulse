## Merge
Ein git merge kommt erst ins Spiel, wenn VSCodium (das Upstream-Projekt) in ein paar Wochen oder Monaten Updates herausbringt, die du in Starfish-Pulse integrieren willst. Der Workflow sieht dann auf deiner Maschine wie folgt aus:

Bash
# 1. Hol dir die neuesten Änderungen vom originalen VSCodium
git fetch upstream

# 2. Stelle sicher, dass du auf deinem Hauptbranch bist
git checkout main

# 3. Jetzt fusionierst du die VSCodium-Updates in deinen Code
git merge upstream/main

# 4. Konflikte lösen (falls vorhanden) und den aktualisierten Stand auf dein GitHub pushen
git push origin main