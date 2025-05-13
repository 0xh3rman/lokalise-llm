# Lokalise LLM Translation CLI

[![CI](https://github.com/0xh3rman/lokalise-llm/actions/workflows/ci.yml/badge.svg)](https://github.com/0xh3rman/lokalise-llm/actions/workflows/ci.yml)

A command-line tool for translating Lokalise project strings using OpenAI's language models.

## Requirements

- Node.js 16+
- pnpm (or npm/yarn)
- Lokalise API token
- OpenAI API key
- Lokalise project ID

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/lokalise-llm.git
cd lokalise-llm

# Install dependencies
pnpm install

# Build the project
pnpm build
```

## Environment Variables

The project uses dotenv to load environment variables from a `.env` file. A template `.env` file has been created for you. Fill in your API keys and project ID:

```
# OpenAI API key
OPENAI_API_KEY=your_openai_api_key

# Lokalise API token
LOKALISE_TOKEN=your_lokalise_api_token

# Lokalise project ID
LOKALISE_PROJECT_ID=your_lokalise_project_id
```

You can obtain:
- OpenAI API key from your [OpenAI dashboard](https://platform.openai.com/api-keys)
- Lokalise API token from your [Lokalise profile](https://app.lokalise.com/profile#apitokens)
- Lokalise project ID from your project URL (e.g., https://app.lokalise.com/project/PROJECT_ID)

## Usage

The CLI provides a three-stage workflow for translating content:

1. **List** - List and download untranslated keys
2. **Translate** - Translate the keys using OpenAI
3. **Push** - Push the translations back to Lokalise

### 1. List and Download Untranslated Keys

List and download untranslated keys from Lokalise:

```bash
pnpm start list --lang zh_CN zh_TW ja
```

Options:
- `--lang` (required): Target languages, e.g., zh_CN ja zh_TW
- `--save`: Save keys to JSON file (default: true)
- `--all`: Include all keys, not just untranslated ones (default: false)

This command will:
- Display a list of untranslated keys in the console with English as the base string
- Save the keys to a single `keys.json` file containing only the requested languages and English

### 2. Translate Keys

Translate keys from a Lokalise project to one or more target languages:

```bash
pnpm start translate --lang zh_CN zh_TW ja --model gpt-4.1-mini --prompt-file prompt.txt --batch-size 20
```

Options:
- `--lang` (required): Target languages, e.g., zh_CN ja zh_TW
- `--model`: OpenAI model to use (default: gpt-4.1-mini)
- `--prompt-file`: Path to prompt template (default: prompt.txt)
- `--batch-size`: Number of keys per batch (default: 20)

This command will:
- Load keys from `keys.json` if it exists, or fetch them from Lokalise if not
- Find keys that have no translation or empty translation for the target language
- Translate these keys using OpenAI with English as the source language
- Save the translations to files (e.g., `translations-zh_CN.json`, `translations-ja.json`) including both source text and translation for easy review

### 3. Push Translations

Push translated strings back to Lokalise:

```bash
pnpm start push --lang zh_CN --file translations-zh_CN.json
```

Options:
- `--lang` (required): Language to push, e.g., zh_CN
- `--file`: Translation file path (default: translations-<lang>.json)

This command will:
- Load translations from the specified file
- Fetch all keys from Lokalise to find existing translations
- Update existing translations or create new ones as needed
- Show a summary of the push operation (updated, created, and failed translations)

## Prompt Template

The prompt template is used to instruct the LLM on how to translate the strings. A sample prompt is provided in `prompt.txt`.

## License

MIT
