import type { TutorClient } from './client.ts';
import { loadModelOptions, resolveTurnModel, type ModelSelection } from './models.ts';

export async function masteryStart(api: TutorClient, path: string, mode: string, choice: ModelSelection | null) {
  const options = await loadModelOptions(api);
  const model = resolveTurnModel(options, choice);
  api.assertOpen();
  return { capability: 'mastery_path', mastery_path_id: path, mastery_session_mode: mode, llm_selection: model };
}
