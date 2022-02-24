import type { Vault, MetadataCache, TFile } from 'obsidian';
import { get } from 'svelte/store';
import { Renderer } from '~/renderer';
import { settingsStore } from '~/store';
import { sanitizeTitle } from '~/utils/sanitizeTitle';
import type { Article } from '~/models';
import { frontMatterDocType, addFrontMatter } from "~/utils/frontmatter"

type AnnotationFile = {
  articleUrl?: string;
  file: TFile;
};

export default class FileManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private renderer: Renderer;

  constructor(vault: Vault, metadataCache: MetadataCache) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.renderer = new Renderer();
  }

  // Save an article as markdown file, replacing its existing file if present
  public async saveArticle(article: Article): Promise<boolean> {
    const existingFile = await this.getArticleFile(article);

    if (existingFile) {
      console.debug(`Updating ${existingFile.path}`);

      const newMarkdownContent = this.renderer.render(article, false);
      const existingFileContent = await this.vault.cachedRead(existingFile);
      const fileContent = existingFileContent + newMarkdownContent;

      await this.vault.modify(existingFile, fileContent);
      return false;
    } else {
      const newFilePath = this.getNewArticleFilePath(article);
      console.debug(`Creating ${newFilePath}`);

      const markdownContent = this.renderer.render(article, true);
      const fileContent = addFrontMatter(markdownContent, article);

      await this.vault.create(newFilePath, fileContent);
      return true;
    }
  }

  public async isArticleSaved(article: Article): Promise<boolean> {
    const file = await this.getArticleFile(article);
    return !!file
  }

  private async getArticleFile(article: Article): Promise<TFile | null> {
    const files = await this.getAnnotationFiles()
    return files.find((file) => file.articleUrl === article.metadata.url)?.file || null;
  }

  // TODO cache this method for performance?
  private async getAnnotationFiles(): Promise<AnnotationFile[]> {
    const files = this.vault.getMarkdownFiles();

    return files
      .map((file) => {
        const cache = this.metadataCache.getFileCache(file);
        return { file, frontmatter: cache?.frontmatter };
      })
      .filter(({ frontmatter }) => frontmatter?.["doc_type"] === frontMatterDocType)
      .map(({ file, frontmatter }): AnnotationFile => ({file, articleUrl: frontmatter["url"]}))
  }

  public getNewArticleFilePath(article: Article): string {
    const settings = get(settingsStore);
    let folderPath = settings.highlightsFolder;

    const fileName = `${sanitizeTitle(article.metadata.title)}.md`;
    const filePath = `${folderPath}/${fileName}`  
    return filePath;
  }

}

