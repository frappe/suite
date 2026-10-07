/** Ordinary Suite calls use a generated reference and one client or composable. */
import { api, engine } from '@/composition/api'

export { api }
export const { client, useQuery, useMutation, useInfiniteQuery, useUpload, onTouch, onChallenge } =
  engine
export type {
  QueryState,
  InfiniteQueryState,
  MutationState,
  UploadState,
} from '@/platform/server-state'

export type InputOf<Ref> = Ref extends { readonly types?: { input: infer I } } ? I : never
export type OutputOf<Ref> = Ref extends { readonly types?: { output: infer O } } ? O : never
