import path from 'path';
import type { SearchConditionInput } from './types';
import type {
  SearchScanRequest,
  SearchScanResponse,
} from './search_worker/search_scan';
import { SearchRepository } from './repository';
import { CdxRepository } from '../cdx/repository';
import { WorkerPool } from '../worker/worker_pool';

export function createSearchWorkerPool(
  dbPath: string,
  maxConcurrentSearches: number,
  maxFileWorkersPerSearch: number,
): WorkerPool {
  return new WorkerPool(
    path.join(__dirname, 'search_worker', 'search_scan.ts'),
    maxConcurrentSearches,
    { dbPath, maxWorkers: maxFileWorkersPerSearch },
  );
}

function runSearchWorker(
  pool: WorkerPool,
  scanRequest: SearchScanRequest,
  searchRepo: SearchRepository,
): void {
  const { searchId } = scanRequest.searchMetadata;
  pool
    .queue<SearchScanRequest, SearchScanResponse>(scanRequest)
    .then((response) => {
      if ('error' in response) {
        searchRepo.setSearchError(response.error, searchId);
      } else {
        searchRepo.setSearchStatus('done', searchId);
      }
    })
    .catch((err: unknown) => {
      searchRepo.setSearchError(String(err), searchId);
    });
}

export async function runSearch(
  pool: WorkerPool,
  conditionInputs: SearchConditionInput[],
  domainNames: string[],
  searchRepo: SearchRepository,
  cdxRepo: CdxRepository,
  baseFolder: string,
  contextSize: number,
): Promise<number> {
  const resolvedDomainNames =
    domainNames.length > 0 ? cdxRepo.findDomainNamesIn(domainNames) : [];

  const total = cdxRepo.countHtmlCandidates(resolvedDomainNames);

  const searchMetadata = searchRepo.initSearch(
    conditionInputs,
    resolvedDomainNames,
    total,
    contextSize,
  );
  const { searchId } = searchMetadata;

  console.log(`[search ${searchId}] Found ${total} HTML document candidates`);

  const scanRequest: SearchScanRequest = {
    searchMetadata,
    baseFolder,
    total,
  };

  runSearchWorker(pool, scanRequest, searchRepo);

  console.log(`[search ${searchId}] Scan started in background`);
  return searchId;
}
