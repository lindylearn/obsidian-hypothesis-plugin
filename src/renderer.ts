import { moment } from 'obsidian';
import nunjucks from 'nunjucks';
import { get } from 'svelte/store';
import { settingsStore } from '~/store';
import type { Article, RenderTemplate } from './models';
import defaultMetadataTemplate from '~/assets/defaultMetadataTemplate.njk';
import defaultAnnotationsTemplate from '~/assets/defaultAnnotationsTemplate.njk';

export class Renderer {
    constructor() {
        nunjucks.configure({ autoescape: false });
    }

    validate(template: string): boolean {
        try {
            nunjucks.renderString(template, {});
            return true;
        } catch (error) {
            return false;
        }
    }

    render(entry: Article, isNew = true): string {
        const { metadata, highlights, page_note } = entry;

        const momentFormat = get(settingsStore).dateTimeFormat;
        const annotationTimestamps = [
            ...new Set(
                highlights.map((h) => moment(h.updated).format(momentFormat))
            ),
        ].sort();

        // TODO format timestamps on individual annotations

        const context: RenderTemplate = {
            ...metadata,
            highlights,
            page_note,
            annotation_dates: annotationTimestamps,
        };

        const metadataTemplate =
            get(settingsStore).customMetadataTemplate ||
            defaultMetadataTemplate;
        const template = metadataTemplate + defaultAnnotationsTemplate;
        const content = nunjucks.renderString(template, context);
        return content;
    }
}
