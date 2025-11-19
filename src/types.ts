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

export interface PackageDependencyDetail {
  name: string;
  files: string[];
  fileCount: number;
}

export interface PackageExternalDependency {
  name: string;
  isDeclared: boolean;
  isUsed: boolean;
  usageCount: number;
  declaredInDependencies: boolean;
  declaredInDevDependencies: boolean;
  isLikelyTypePackage: boolean;
  isToolingOnly: boolean;
}

export interface ReportPackage {
  name: string;
  version?: string;
  description?: string;
  fileCount: number;
  relativeDir: string;
  isRoot: boolean;
  hasChildPackages: boolean;
  hasTailwindConfig: boolean;
  hasTsconfig: boolean;
  hasAutoprefixer: boolean;
  hasEslintConfig: boolean;
  dependencies: string[];
  declaredDeps: string[];
  undeclaredDeps: string[];
  references: number;
  cyclicDeps: string[];
  dependencyDetails: PackageDependencyDetail[];
  externalDependencies: PackageExternalDependency[];
  undeclaredExternalDeps: string[];
  unusedExternalDeps: string[];
  toolingDeps: string[];
}

export interface DependencyReport {
  rootDir: string;
  packages: ReportPackage[];
}

export interface GenerateReportSnapshotEvent {
  message: string;
  progress?: number;
  report: DependencyReport;
}

export interface GenerateReportOptions {
  rootDir?: string;
  exclude?: string[];
  onSnapshot?: (event: GenerateReportSnapshotEvent) => void;
}
