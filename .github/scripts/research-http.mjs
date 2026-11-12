/** Contact identifiers belong only in SEC requests, never market-data headers,
 * console output, portfolio results or the public repository. */
export const GENERIC_RESEARCH_USER_AGENT = 'PersonalPortfolioResearch https://github.com/alvissome/portfolio';
const CONTACT_CONFIG_ERROR = 'Invalid SEC_CONTACT_EMAIL configuration; correct or remove the repository secret.';

export function buildSecUserAgent(contactEmail) {
  if (contactEmail == null || contactEmail === '') return GENERIC_RESEARCH_USER_AGENT;
  const invalid = () => {
    const error = new TypeError(CONTACT_CONFIG_ERROR);
    error.code = 'SEC_CONTACT_EMAIL_INVALID';
    throw error;
  };
  if (typeof contactEmail !== 'string' || /[\x00-\x1f\x7f]/.test(contactEmail)) return invalid();
  const contact = contactEmail.trim();
  if (!contact) return GENERIC_RESEARCH_USER_AGENT;
  if (contact.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(contact)) return invalid();
  const local = contact.split('@')[0];
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return invalid();
  return `PersonalPortfolioResearch ${contact}`;
}

export function secContactConfigurationMessage(error) {
  return error?.code === 'SEC_CONTACT_EMAIL_INVALID' ? CONTACT_CONFIG_ERROR : null;
}
