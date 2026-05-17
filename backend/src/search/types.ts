export interface SearchCondition {
  id: number;
  regex: RegExp;
  notRegexNearby: RegExp | null;
  contextSize: number;
}

export interface SearchConditionInput {
  regex: RegExp;
  notRegexNearby?: RegExp;
}

export interface SearchMetadata {
  searchId: number;
  domainNames: string[];
  conditions: SearchCondition[];
}

export interface FileMatch {
  conditionId: number;
  matchOffset: number;
  matchLength: number;
}

export type FileMatches = {
  matches: FileMatch[];
  contextDigest: string;
};
