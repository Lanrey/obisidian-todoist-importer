![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import your Todoist projects and tasks into your Obsidian vault. Tasks are converted to plain text Markdown files.

## Todoist Integration

### Get your Todoist API token

1. Open Todoist and go to **Settings → Integrations → Developer**
2. Copy your personal API token

### Add the plugin to your local Obsidian

This plugin is not yet published to the Obsidian Community Plugins directory, so you need to install it manually.

**Prerequisites:** [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) must be installed on your machine.

**Steps:**

1. Clone or download this repository to your machine:
   ```bash
   git clone https://github.com/obsidianmd/obsidian-importer.git
   cd obsidian-importer
   ```

2. Install dependencies and build the plugin:
   ```bash
   npm install
   npm run build
   ```

3. Copy the built files into your Obsidian vault's plugins folder:
   ```bash
   # Replace <your-vault> with the path to your vault
   mkdir -p <your-vault>/.obsidian/plugins/todoist-obsidian-importer
   cp main.js manifest.json styles.css <your-vault>/.obsidian/plugins/todoist-obsidian-importer/
   ```

4. In Obsidian, go to **Settings → Community Plugins**, disable **Safe mode** if prompted, then enable **Todoist Obsidian Importer**.

### Import your Todoist data

1. Open the **Importer** plugin (ribbon icon or Command Palette → "Open Importer")
2. Select **Todoist (API)** from the format dropdown
3. Paste your API token into the **API Token** field
4. Click **Load** to fetch your projects
5. Check the projects you want to import
6. (Optional) Enable **Import task comments** to include comments on each task
7. Set your preferred **Output folder** (default: `Todoist`)
8. Click **Import**

One Markdown file will be created per project inside the output folder.

### Output format

Each project file includes a YAML frontmatter block and tasks rendered as Obsidian-compatible checklists:

```markdown
---
todoist-id: "12345"
url: "https://todoist.com/app/project/12345"
color: berry
---

- [ ] Task title ⏫ 📅 2025-01-15 #label1 #label2
  Task description if any
  > A comment on this task
  - [ ] Subtask

## Section Name

- [x] Completed task 🔼
```

**Priority indicators** map to the [Obsidian Tasks](https://publish.obsidian.md/tasks) plugin convention:

| Todoist priority | Emoji |
|---|---|
| P1 (urgent) | ⏫ |
| P2 (high) | 🔼 |
| P3 (medium) | 🔽 |
| P4 (normal) | *(none)* |

## Contributing

Is something not working? You can help! See our [Contribution guidelines](/CONTRIBUTING.md).
