export interface PkgInfo {
  name: string;
  version: string;
  description?: string;
  dir: string;
  declaredDeps?: string[];
  declaredProdDeps?: string[];
  declaredDevDeps?: string[];
  hasTsconfig?: boolean;
  hasTailwindConfig?: boolean;
  hasAutoprefixer?: boolean;
  hasEslintConfig?: boolean;
  hasChildPackages?: boolean;
  toolingDeps?: string[];
  fileCount: number;
}

export type EdgeMap = Map<string, Set<string>>;

export interface GenerateReportOptions {
  rootDir?: string;
  outputHtml?: string;
  exclude?: string[];
}
