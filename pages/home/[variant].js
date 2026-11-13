import Index, { getStaticProps as homeProps } from '../index';
import { VARIANTS } from '../../src/lib/discovery/core.mjs';

export default Index;
export async function getStaticPaths() {
  return { paths: VARIANTS.map(variant => ({ params: { variant } })), fallback: false };
}
export async function getStaticProps({ params }) {
  if (process.env.DISCOVERY_ENABLED !== '1' || !VARIANTS.includes(params.variant)) return { notFound: true };
  const result = await homeProps();
  return { ...result, props: { ...result.props, homeVariant: params.variant } };
}
