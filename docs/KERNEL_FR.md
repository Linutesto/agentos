# AgentOS / Cognitive Kernel

Un noyau cognitif minimaliste pour orchestrer des agents IA, optimisé pour Termux sur Android. Ce projet est conçu pour être modulaire, extensible et sans dépendances lourdes. Les LLMs y agissent comme des processus clients effectuant des syscalls via un ToolBus.

## Caractéristiques
- **ToolBus** : Registre dynamique de capacités avec gestion des permissions et timeout.
- **EventBus** : Traçabilité complète via des événements système et un log d'audit.
- **Memory** : Persistance légère via `node:sqlite` (natif Node 22+).
- **Providers** : OpenAI, Gemini et Ollama.
- **TUI** : Interface terminal clavier-first (Dashboard, Tools, Logs, etc.).
- **Cloudflare** : Outils de gestion DNS intégrés.

## Installation (Termux)
Ce script installera Node.js, git, curl, jq, sqlite et les dépendances locales.

```bash
chmod +x install-termux.sh
./install-termux.sh
```

## Utilisation

**Lancer la TUI (Terminal User Interface)** :
```bash
agentos tui
```
*Shortcuts TUI : `q` ou `Esc` pour quitter. `1`, `2`, `3`, `4` pour naviguer.*

**Explorer les capacités (Syscalls)** :
```bash
agentos tool list
agentos tool search memory
agentos tool describe memory.write
agentos tool exec memory.search '{"key":"test"}'
```

**Plugin Cloudflare** :
```bash
agentos cf set-token TON_TOKEN
agentos cf verify
agentos cf zones
```

**Tester la boucle Agent (Simulation)** :
```bash
agentos loop-test
```
