# Lokalise LLM Translation CLI

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

Create a `.env` file in the root directory with the following variables:

```
OPENAI_API_KEY=your_openai_api_key
LOKALISE_TOKEN=your_lokalise_api_token
LOKALISE_PROJECT_ID=your_lokalise_project_id
```

## Usage

### Translate Keys

Translate keys from a Lokalise project to one or more target languages:

```bash
pnpm start translate --lang zh-CN ja --model gpt-4.1-mini --prompt-file prompt.txt --batch-size 20
```

Options:
- `--lang` (required): Target languages, e.g., zh-CN ja zh-TW
- `--model`: OpenAI model to use (default: gpt-4.1-mini)
- `--prompt-file`: Path to prompt template (default: prompt.txt)
- `--batch-size`: Number of keys per batch (default: 20)

### Push Translations

Push translated strings back to Lokalise:

```bash
pnpm start push --lang zh-CN --file translations-zh-CN.json
```

Options:
- `--lang` (required): Language to push, e.g., zh-CN
- `--file`: Translation file path (default: translations-<lang>.json)

## Prompt Template

The prompt template is used to instruct the LLM on how to translate the strings. A sample prompt is provided in `prompt.txt`.

## License

MIT
