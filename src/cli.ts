#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { Configuration, OpenAIApi } from 'openai';
import { LokaliseApi } from '@lokalise/node-api';

// Environment variables required: OPENAI_API_KEY, LOKALISE_TOKEN, LOKALISE_PROJECT_ID
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LOKALISE_TOKEN = process.env.LOKALISE_TOKEN;
const PROJECT_ID = process.env.LOKALISE_PROJECT_ID;

if (!OPENAI_API_KEY || !LOKALISE_TOKEN || !PROJECT_ID) {
    console.error('Error: Missing ONE of OPENAI_API_KEY, LOKALISE_TOKEN, or LOKALISE_PROJECT_ID');
    process.exit(1);
}

const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));
const lokalise = new LokaliseApi({ apiKey: LOKALISE_TOKEN });
const OUTPUT_DIR = './';

// Retrieve all keys from Lokalise, including existing translations
async function fetchKeys() {
    if (!PROJECT_ID) {
        throw new Error('PROJECT_ID is required');
    }
    const response = await lokalise.keys().list({
        project_id: PROJECT_ID,
        include_translations: 1,
    });

    // Map the response to the format we need
    return response.items.map(key => ({
        key_id: key.key_id,
        base_string: key.translations?.[0]?.translation || '',
        translations: key.translations
    }));
}

// Perform batch translation via OpenAI, returning parsed JSON results
async function translateBatch(
    batch: Array<{ key_id: number; base_string: string }>,
    lang: string,
    model: string,
    template: string
): Promise<Array<{ key_id: number; translation: string }>> {
    const inputList = batch.map(k => ({ key_id: k.key_id, text: k.base_string }));
    const userContent = `${template}

Return results as a JSON array with this format:
[
  {"key_id":123, "translation":"..."},
  {"key_id":456, "translation":"..."}
]

Input list:
${JSON.stringify(inputList, null, 2)}`;

    const res = await openai.createChatCompletion({
        model,
        messages: [
            { role: 'system', content: 'You are a professional translation engine. Translate in batches and output strictly valid JSON.' },
            { role: 'user', content: userContent },
        ],
        temperature: 0.0,
    });

    if (!res.data.choices[0].message || !res.data.choices[0].message.content) {
        throw new Error('No response from OpenAI');
    }

    const raw = res.data.choices[0].message.content.trim();
    try {
        return JSON.parse(raw) as Array<{ key_id: number; translation: string }>;
    } catch (e) {
        console.error('Failed to parse JSON from translation response:', raw);
        throw e;
    }
}

// Main translation command supporting multiple languages and batching
async function commandTranslate(
    langs: string[],
    model: string,
    promptFile: string,
    batchSize: number
) {
    console.log(`Loading prompt template from ${promptFile}...`);
    const template = fs.readFileSync(path.resolve(promptFile), 'utf-8');

    console.log(`Fetching keys from project ${PROJECT_ID}...`);
    const allKeys = await fetchKeys();

    for (const lang of langs) {
        const keysToTranslate = allKeys.filter(key => {
            if (!key.base_string) return false;
            return !key.translations?.some(t => t.language_iso === lang);
        });

        console.log(
            `Translating to ${lang} with model ${model}: ${keysToTranslate.length} keys, batch size ${batchSize}`
        );

        const translations: Array<{ key_id: number; source: string; translation: string }> = [];

        for (let i = 0; i < keysToTranslate.length; i += batchSize) {
            const batch = keysToTranslate.slice(i, i + batchSize);
            console.log(`Processing batch ${i / batchSize + 1} (${batch.length} keys)...`);

            try {
                const results = await translateBatch(batch, lang, model, template);
                results.forEach(r => {
                    translations.push({ key_id: r.key_id, source: '', translation: r.translation });
                    console.log(`→ [${r.key_id}] ${r.translation}`);
                });
            } catch (e) {
                console.error(`Batch ${i / batchSize + 1} failed:`, e);
            }

            // Pause to respect rate limits
            await new Promise(r => setTimeout(r, 500));
        }

        const outFile = path.resolve(OUTPUT_DIR, `translations-${lang}.json`);
        fs.writeFileSync(outFile, JSON.stringify(translations, null, 2));
        console.log(`Translations saved to ${outFile}`);
    }
}

// Command to push translations back to Lokalise
async function commandPush(lang: string, file: string) {
    const data = JSON.parse(
        fs.readFileSync(path.resolve(file), 'utf-8')
    ) as Array<{ key_id: number; translation: string }>;

    const batchSize = 50;
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize).map(item => ({
            key_id: item.key_id,
            language_iso: lang,
            translation: item.translation,
        }));

        try {
            // Update translations one by one since the bulk create endpoint is not available
            for (const item of batch) {
                // First we need to find the translation ID for this key and language
                if (!PROJECT_ID) {
                    throw new Error('PROJECT_ID is required');
                }

                // Find the translation by key ID and language
                const keys = await lokalise.keys().list({
                    project_id: PROJECT_ID,
                    include_translations: 1,
                    filter_keys: item.key_id.toString(),
                    limit: 1
                });

                // Find the translation for the specified language
                const key = keys.items[0];
                const translationObj = key?.translations?.find(t => t.language_iso === lang);

                if (translationObj && translationObj.translation_id) {
                    await lokalise.translations().update(
                        translationObj.translation_id,
                        { translation: item.translation },
                        { project_id: PROJECT_ID }
                    );
                } else {
                    console.warn(`No translation found for key ${item.key_id} in language ${lang}`);
                }
            }
            console.log(`Pushed batch ${i / batchSize + 1}`);
        } catch (e) {
            console.error(`Failed to push batch ${i / batchSize + 1}:`, e);
        }

        // Pause to respect rate limits
        await new Promise(r => setTimeout(r, 500));
    }
    console.log('All translations pushed successfully.');
}

// CLI setup
const program = new Command();
program.version('1.0.0').description('Lokalise + LLM Translation CLI');

program
    .command('translate')
    .description('Fetch keys and generate translations, saving language-specific files')
    .requiredOption('-l, --lang <langs...>', 'Target languages, e.g. zh-CN ja zh-TW')
    .option('-m, --model <model>', 'OpenAI model to use', 'gpt-4.1-mini')
    .option('-p, --prompt-file <file>', 'Path to prompt template', 'prompt.txt')
    .option('-b, --batch-size <number>', 'Number of keys per batch', '20')
    .action(opts =>
        commandTranslate(
            opts.lang,
            opts.model,
            opts.promptFile,
            parseInt(opts.batchSize, 10)
        )
    );

program
    .command('push')
    .description('Push translation file back to Lokalise')
    .requiredOption('-l, --lang <lang>', 'Language to push, e.g. zh-CN')
    .option('-f, --file <file>', 'Translation file path', `translations-<lang>.json`)
    .action(opts => {
        const file = opts.file.replace('<lang>', opts.lang);
        commandPush(opts.lang, file);
    });

program.parse(process.argv);
