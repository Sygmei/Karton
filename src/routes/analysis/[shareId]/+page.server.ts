import { error } from '@sveltejs/kit';

import { reconcileAnalysisCardNames } from '$lib/server/analysis';
import { findAnalysisRunByShareId } from '$lib/server/analysis-runs-repo';
import { withSpan } from '$lib/server/otel';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  return await withSpan('page.analysis_share.view', { 'analysis.share_url': url.toString() }, async () => {
    const shareId = params.shareId?.trim();
    if (!shareId) {
      throw error(404, 'Analysis not found');
    }

    const run = await findAnalysisRunByShareId(shareId);
    if (!run) {
      throw error(404, 'Analysis not found');
    }

    const analysis = reconcileAnalysisCardNames(run.payload.analysis);

    return {
      shareId: run.shareId,
      shareUrl: url.toString(),
      createdAt: run.createdAt,
      commanderName: run.commanderName || run.payload.commander.name,
      ignoreBefore: run.ignoreBefore || analysis.startDate,
      ignoreAfter: run.ignoreAfter || analysis.endDate,
      output: {
        ...run.payload,
        analysis,
        share: {
          id: run.shareId,
          url: url.toString()
        }
      }
    };
  });
};
