import { createClient } from 'contentful';
import { config } from './config';

export const contentfulClient = createClient({
  space: config.contentful.spaceId,
  accessToken: config.contentful.accessToken,
});
