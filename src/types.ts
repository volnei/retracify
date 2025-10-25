export interface PkgInfo {
  name: string;
  version: string;
  description?: string;
  dir: string;
  declaredDeps?: string[];
  fileCount: number;
}

export type EdgeMap = Map<string, Set<string>>;

export interface GenerateGraphOptions {
  rootDir?: string;
  outputHtml?: string;
  exclude?: string[];
}
