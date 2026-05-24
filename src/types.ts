export interface ValidateResult {
  valid: boolean;
  error: string | null;
  error_line: number | null;
  error_col: number | null;
}

export interface SearchResult {
  path: string;
  key: string | null;
  value: string | null;
  match_type: string; // "key" | "value"
}

export interface DiffItem {
  path: string;
  diff_type: string; // "added" | "removed" | "changed"
  left: string | null;
  right: string | null;
}

export interface JsonPathResult {
  results: string[];
  paths: string[];
}
