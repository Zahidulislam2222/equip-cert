import { createClient } from 'contentful';
import { config } from './config';

/**
 * The Contentful client, or null when the CMS is not configured.
 *
 * `createClient` THROWS ("Expected parameter accessToken") on an empty token, and it used to run at
 * module load — so a build without Contentful keys crashed the whole inspection screen with "This
 * page couldn't load", although the built-in checklists need no CMS at all (found by CI's browser
 * job, 2026-11-25). Callers treat null exactly like an unreachable CMS.
 */
export const contentfulClient: ReturnType<typeof createClient> | null =
  config.contentful.spaceId && config.contentful.accessToken
    ? createClient({ space: config.contentful.spaceId, accessToken: config.contentful.accessToken })
    : null;
