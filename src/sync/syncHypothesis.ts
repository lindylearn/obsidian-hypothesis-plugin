import { settingsStore, syncSessionStore } from '~/store';
import type { SyncState } from './syncState';
import { get } from 'svelte/store';
import ApiManager from '~/api/api';
import parseSyncResponse from '~/parser/parseSyncResponse';
import SyncGroup from './syncGroup';
import type FileManager from '~/fileManager';
import { Article, Highlights, LocalHighlight, RemoteState } from '~/models';
import { reconcileHighlights } from '~/bidirectional-sync/reconcileHighlights'


export default class SyncHypothesis {

    private syncState: SyncState = { newArticlesSynced: 0, newHighlightsSynced: 0 };
    private syncGroup: SyncGroup;
    private fileManager: FileManager;

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager;
        this.syncGroup = new SyncGroup;
    }

    async startSync(uri?: string) {
        this.syncState = { newArticlesSynced: 0, newHighlightsSynced: 0 };

        const token = await get(settingsStore).token;
        const userid = await get(settingsStore).user;

        const apiManager = new ApiManager(token, userid);

        syncSessionStore.actions.startSync();

        //fetch groups
        await this.syncGroup.startSync();

        //fetch highlights
        const responseBody: [] = (!uri) ? await apiManager.getHighlights(get(settingsStore).lastSyncDate) : await apiManager.getHighlightWithUri(uri);
        const articles = await parseSyncResponse(responseBody);

        syncSessionStore.actions.setJobs(articles);

        if (articles.length > 0) {
            await this.syncArticles(articles, apiManager);
        }

        syncSessionStore.actions.completeSync({
            newArticlesCount: this.syncState.newArticlesSynced,
            newHighlightsCount: this.syncState.newHighlightsSynced,
            updatedArticlesCount: 0,
            updatedHighlightsCount: 0,
        });
    }

    private async syncArticles(articles: Article[], apiManager: ApiManager): Promise<void> {
        for (const article of articles) {
            try {
                syncSessionStore.actions.startJob(article);

                await this.syncArticle(article, apiManager);

                syncSessionStore.actions.completeJob(article);

            } catch (e) {
                console.error(`Error syncing ${article.metadata.title}`, e);
                syncSessionStore.actions.errorJob(article);
            }
        }
    }

    private async syncArticle(article: Article, apiManager: ApiManager): Promise<void> {
        const reconciledArticle = await this.reconcileArticle(article, apiManager);

        const createdNewArticle = await this.fileManager.createOrUpdate(reconciledArticle);

        if (createdNewArticle) {
            this.syncState.newArticlesSynced += 1;
        }
        this.syncState.newHighlightsSynced += reconciledArticle.highlights.length;
    }

    private async reconcileArticle(remoteArticle: Article, apiManager: ApiManager) {
        // Parse local file
        const [localHighlights, localUpdateTimeMillis] = await this.fileManager.parseLocalHighlights(remoteArticle);

        // Compare local & remote state
        const reconciledArticle = reconcileHighlights(remoteArticle, localHighlights, localUpdateTimeMillis);
        reconciledArticle.highlights.sort((a, b) => a.created > b.created ? -1 : 1 ) // TODO keep existing structure, only append?
  
        // Print debug info
        const annotationStateCount = reconciledArticle.highlights.reduce((obj, annotation) => ({
          ...obj,
          [RemoteState[annotation.remote_state]]: (obj[RemoteState[annotation.remote_state]] || 0) + 1
        }), {})
        const nonStandardStateCount = annotationStateCount[RemoteState[RemoteState.SYNCHRONIZED]]
        if (nonStandardStateCount !== reconciledArticle.highlights.length && reconciledArticle.highlights.length !== 0) {
          console.info(`${reconciledArticle.metadata.url} annotation state:`, annotationStateCount)
        }
  
        // Upload changes
        const annotationsToUpload = reconciledArticle.highlights
          .filter(h => h.remote_state === RemoteState.UPDATED_LOCAL)
        if (annotationsToUpload.length > 0) {
          console.info(`${reconciledArticle.metadata.url}: Updating ${annotationsToUpload.length} annotations on Hypothesis.`)
          await Promise.all(annotationsToUpload.map(({id, annotation, tags}) => apiManager.updateAnnotation(id, annotation, tags)))
        }

        return reconciledArticle;
    }
}