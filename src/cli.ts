#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { Configuration, OpenAIApi } from 'openai';
import { LokaliseApi } from '@lokalise/node-api';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

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
async function fetchKeys(filterUntranslated = false, targetLang?: string) {
    if (!PROJECT_ID) {
        throw new Error('PROJECT_ID is required');
    }

    const params: any = {
        project_id: PROJECT_ID,
        include_translations: 1,
        limit: 500,
    };

    // Add filter for untranslated keys if requested
    if (filterUntranslated) {
        params.filter_untranslated = 1;

        // If target language is specified, filter by that language
        if (targetLang) {
            params.filter_lang_iso = targetLang;
        }
    }

    const response = await lokalise.keys().list(params);

    // Map the response to the format we need
    return response.items.map(key => {
        // Find the English translation to use as base_string
        const englishTranslation = key.translations?.find(t =>
            t.language_iso === 'en' || t.language_iso === 'en_US' || t.language_iso === 'en-US'
        );

        return {
            key_id: key.key_id,
            key_name: key.key_name,
            base_string: englishTranslation?.translation || key.translations?.[0]?.translation || '',
            translations: key.translations
        };
    });
}

// Perform batch translation via OpenAI, returning parsed JSON results
async function translateBatch(
    batch: Array<{ key_id: number; base_string: string }>,
    lang: string, // Target language (used in the template)
    model: string,
    template: string
): Promise<Array<{ key_id: number; translation: string }>> {
    // Replace {language} placeholder in template with the actual language
    const processedTemplate = template.replace('{language}', lang);

    // Create input list with key_id and text (the English source)
    const inputList = batch.map(k => ({
        key_id: k.key_id,
        text: k.base_string
    }));

    const userContent = `${processedTemplate}

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

    // Try to load keys from keys.json first
    let allKeys;
    const keysFile = path.resolve(OUTPUT_DIR, 'keys.json');

    if (fs.existsSync(keysFile)) {
        console.log(`Loading keys from ${keysFile}...`);
        allKeys = JSON.parse(fs.readFileSync(keysFile, 'utf-8'));
    } else {
        console.log(`Keys file not found. Fetching keys from project ${PROJECT_ID}...`);
        // Create a set of target languages for easy lookup
        const targetLangs = new Set(langs);

        // Fetch keys for the first language
        const keys = await fetchKeys(true, langs[0]);

        // Filter translations to only include requested languages and English
        allKeys = keys.map(key => ({
            ...key,
            translations: key.translations?.filter(t =>
                targetLangs.has(t.language_iso) ||
                t.language_iso === 'en' ||
                t.language_iso === 'en_US' ||
                t.language_iso === 'en-US'
            )
        }));
    }

    for (const lang of langs) {
        const keysToTranslate = allKeys.filter((key: any) => {
            // Skip keys without a base string (English translation)
            if (!key.base_string) return false;

            // Find the translation for this language
            const translation = key.translations?.find((t: any) => t.language_iso === lang);

            // Include keys that either have no translation for this language
            // or have an empty translation
            return !translation || translation.translation === "";
        });

        console.log(
            `Translating to ${lang} with model ${model}: ${keysToTranslate.length} keys, batch size ${batchSize}`
        );

        // Debug: Show some examples of keys that need translation
        if (keysToTranslate.length > 0) {
            console.log("Examples of keys that need translation:");
            keysToTranslate.slice(0, 3).forEach((key: any, index: number) => {
                const translation = key.translations?.find((t: any) => t.language_iso === lang);
                console.log(`  ${index + 1}. [${key.key_id}] ${key.key_name.ios}: "${key.base_string.substring(0, 30)}${key.base_string.length > 30 ? '...' : ''}" (${translation ? 'empty translation' : 'no translation entry'})`);
            });
        }

        const translations: Array<{ key_id: number; source: string; translation: string }> = [];

        for (let i = 0; i < keysToTranslate.length; i += batchSize) {
            const batch = keysToTranslate.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} keys)...`);

            try {
                const results = await translateBatch(batch, lang, model, template);
                results.forEach(r => {
                    // Find the original key to get the base_string (English source)
                    const originalKey = allKeys.find((key: any) => key.key_id === r.key_id);
                    const source = originalKey?.base_string || '';

                    translations.push({
                        key_id: r.key_id,
                        source: source,
                        translation: r.translation
                    });
                    console.log(`→ [${r.key_id}] "${source.substring(0, 30)}${source.length > 30 ? '...' : ''}" → "${r.translation}"`);
                });
            } catch (e) {
                console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, e);
            }

            // Pause to respect rate limits
            await new Promise(r => setTimeout(r, 500));
        }

        const outFile = path.resolve(OUTPUT_DIR, `translations-${lang}.json`);
        fs.writeFileSync(outFile, JSON.stringify(translations, null, 2));
        console.log(`Translations saved to ${outFile}`);
    }
}

// Command to list and download untranslated keys
async function commandList(langs: string[], saveToFile: boolean, includeTranslated: boolean) {
    console.log(`Fetching keys from project ${PROJECT_ID}...`);

    // Create a set of target languages for easy lookup
    const targetLangs = new Set(langs);

    // We'll fetch keys for the first language to get a baseline
    const firstLang = langs[0];
    console.log(`\nFetching keys for language: ${firstLang}`);

    // Fetch keys that need translation for this language
    const keys = await fetchKeys(!includeTranslated, firstLang);

    if (keys.length === 0) {
        console.log(`No ${includeTranslated ? '' : 'untranslated '}keys found for language ${firstLang}`);
        return;
    }

    console.log(`Found ${keys.length} ${includeTranslated ? '' : 'untranslated '}keys for language ${firstLang}`);

    // Filter translations to only include requested languages and English (for base_string)
    const filteredKeys = keys.map(key => ({
        ...key,
        translations: key.translations?.filter(t =>
            targetLangs.has(t.language_iso) ||
            t.language_iso === 'en' ||
            t.language_iso === 'en_US' ||
            t.language_iso === 'en-US'
        )
    }));

    // Display keys in the console
    filteredKeys.forEach((key, index) => {
        console.log(`${index + 1}. [${key.key_id}] ${key.key_name}: "${key.base_string.substring(0, 50)}${key.base_string.length > 50 ? '...' : ''}"`);
    });

    // Save keys to file if requested
    if (saveToFile) {
        const outFile = path.resolve(OUTPUT_DIR, `keys.json`);
        fs.writeFileSync(outFile, JSON.stringify(filteredKeys, null, 2));
        console.log(`Keys saved to ${outFile}`);
    }
}

// Command to push translations back to Lokalise
async function commandPush(lang: string, file: string) {
    const data = JSON.parse(
        fs.readFileSync(path.resolve(file), 'utf-8')
    ) as Array<{ key_id: number; source: string; translation: string }>;

    if (!PROJECT_ID) {
        throw new Error('PROJECT_ID is required');
    }

    console.log(`Pushing ${data.length} translations to Lokalise for language ${lang}...`);

    // First, get all the keys in a single request to reduce API calls
    console.log("Fetching all keys from Lokalise...");
    const allKeysResponse = await lokalise.keys().list({
        project_id: PROJECT_ID,
        include_translations: 1,
        limit: 5000 // Get as many as possible in one request
    });

    // Create a map of key_id to key for faster lookup
    const keyMap = new Map();
    for (const key of allKeysResponse.items) {
        keyMap.set(key.key_id, key);
    }

    console.log(`Found ${keyMap.size} keys in the project.`);

    const batchSize = 50;
    let successCount = 0;
    let updateCount = 0;
    let createCount = 0;
    let errorCount = 0;

    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(data.length / batchSize)} (${batch.length} translations)...`);

        try {
            // Process translations one by one
            for (const item of batch) {
                try {
                    // Find the key in our map
                    const key = keyMap.get(item.key_id);

                    if (!key) {
                        console.warn(`Key ${item.key_id} not found in the project.`);
                        errorCount++;
                        continue;
                    }

                    // Find the translation for the specified language
                    const translationObj = key.translations?.find((t: any) => t.language_iso === lang);

                    if (translationObj && translationObj.translation_id) {
                        // Update existing translation
                        await lokalise.translations().update(
                            translationObj.translation_id,
                            { translation: item.translation },
                            { project_id: PROJECT_ID }
                        );
                        updateCount++;
                    } else {
                        // Create new translation using the bulk update endpoint
                        await lokalise.keys().bulk_update(
                            {
                                keys: [
                                    {
                                        key_id: item.key_id,
                                        translations: [
                                            {
                                                language_iso: lang,
                                                translation: item.translation
                                            }
                                        ]
                                    }
                                ]
                            },
                            { project_id: PROJECT_ID }
                        );
                        createCount++;
                    }

                    successCount++;
                } catch (itemError) {
                    console.error(`Error processing key ${item.key_id}:`, itemError);
                    errorCount++;
                }

                // Small pause between individual translations to respect rate limits
                await new Promise(r => setTimeout(r, 100));
            }

            console.log(`Completed batch ${Math.floor(i / batchSize) + 1}`);
        } catch (batchError) {
            console.error(`Failed to process batch ${Math.floor(i / batchSize) + 1}:`, batchError);
        }

        // Pause between batches to respect rate limits
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`
Translation push summary:
- Total: ${data.length}
- Successful: ${successCount}
  - Updated: ${updateCount}
  - Created: ${createCount}
- Failed: ${errorCount}
`);
}

// CLI setup
const program = new Command();
program.version('1.0.0').description('Lokalise + LLM Translation CLI');

program
    .command('list')
    .description('List and download untranslated keys from Lokalise')
    .requiredOption('-l, --lang <langs...>', 'Target languages, e.g. zh_CN ja zh_TW')
    .option('-s, --save', 'Save keys to JSON file', true)
    .option('-a, --all', 'Include all keys, not just untranslated ones', false)
    .action(opts =>
        commandList(
            opts.lang,
            opts.save,
            opts.all
        )
    );

program
    .command('translate')
    .description('Fetch keys and generate translations, saving language-specific files')
    .requiredOption('-l, --lang <langs...>', 'Target languages, e.g. zh_CN ja zh_TW')
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
    .requiredOption('-l, --lang <lang>', 'Language to push, e.g. zh_CN')
    .option('-f, --file <file>', 'Translation file path', `translations-<lang>.json`)
    .action(opts => {
        const file = opts.file.replace('<lang>', opts.lang);
        commandPush(opts.lang, file);
    });

program.parse(process.argv);
