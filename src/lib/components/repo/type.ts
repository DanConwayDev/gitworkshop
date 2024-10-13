export type RepoPage = 'about' | 'issues' | 'proposals'

export interface RepoReadme {
  md: string
  loading: boolean
  failed: boolean
}

export const readme_defaults: RepoReadme = {
  md: '',
  loading: true,
  failed: false,
}
