/**
 * MySQL Image Supply Chain Policy
 * 
 * Implements Docker image supply chain security for trusted MySQL runner.
 * Addresses IMG-GAP-01 CRITICAL finding: No approved MySQL 8.4 digest exists.
 * 
 * SECURITY POLICY:
 * - Default approved digest set is EMPTY
 * - Empty allowlist MUST reject all runtime provisioning
 * - No digest may be added without security team approval process:
 *   1. Pull candidate image (mysql:8.4.3 or specific patch)
 *   2. Extract manifest digest (docker inspect --format '{{.RepoDigests}}')
 *   3. Scan for CVEs (Trivy, Grype, or security scanner)
 *   4. Document approval decision with CVE assessment
 *   5. Add platform-specific digest to APPROVED_MYSQL_8_4_DIGESTS
 * 
 * OFFLINE IMPLEMENTATION: All validation logic is pure and testable without Docker.
 * 
 * @module mysql-image-policy
 */

'use strict';

/**
 * Approved MySQL 8.4 image digests (immutable manifest references).
 * 
 * CRITICAL SECURITY CONTROL:
 * This Map is intentionally EMPTY until security team approval.
 * Do NOT hardcode mysql:8.4.3 or any unapproved digest.
 * 
 * Format: Map<platform, digestString>
 * Example entry (DO NOT ADD without approval):
 *   'linux/amd64' => 'sha256:1234567890abcdef...'
 * 
 * @constant {Map<string, string>}
 */
const APPROVED_MYSQL_8_4_DIGESTS = new Map();

// IMG-GAP-01: EMPTY approved digest set - no runtime provisioning authorized
// Security team approval required before adding any entry

/**
 * Valid MySQL platforms.
 * Only linux/amd64 and linux/arm64 are supported for MySQL 8.4.
 * 
 * @constant {Set<string>}
 */
const VALID_PLATFORMS = new Set(['linux/amd64', 'linux/arm64']);

/**
 * Mutable tag patterns that MUST be rejected (non-immutable references).
 * 
 * @constant {RegExp[]}
 */
const MUTABLE_TAG_PATTERNS = [
  /:latest$/,
  /:8\.4$/,
  /:8$/,
  /^mysql$/,  // bare "mysql" implies :latest
];

/**
 * Check if a digest is in the approved allowlist for a given platform.
 * 
 * @param {string} digest - Image digest in format "sha256:hexstring"
 * @param {string} platform - Platform identifier (e.g., "linux/amd64")
 * @returns {boolean} - True if digest is approved for platform
 * @throws {Error} - If digest format is invalid
 */
function isApprovedDigest(digest, platform = 'linux/amd64') {
  validateDigestFormat(digest);
  validatePlatform(platform);
  
  const approvedDigest = APPROVED_MYSQL_8_4_DIGESTS.get(platform);
  if (!approvedDigest) {
    throw new Error(
      `No approved MySQL 8.4 digest exists for platform ${platform}. ` +
      `IMG-GAP-01: Security team approval required. Default allowlist is EMPTY.`
    );
  }
  
  if (approvedDigest !== digest) {
    throw new Error(
      `Digest ${digest} not in approved list for ${platform}. ` +
      `Expected: ${approvedDigest}`
    );
  }
  
  return true;
}

/**
 * Validate digest format (sha256:hexstring).
 * 
 * @param {string} digest - Digest string to validate
 * @throws {Error} - If digest format is invalid
 */
function validateDigestFormat(digest) {
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  if (!digestPattern.test(digest)) {
    throw new Error(
      `Invalid digest format: ${digest}. ` +
      `Expected format: sha256:[64 hex chars]`
    );
  }
}

/**
 * Validate a complete image reference.
 * 
 * @param {string} imageRef - Image reference (e.g., "mysql@sha256:abc..." or "mysql:8.4.3")
 * @param {string} platform - Target platform
 * @returns {object} - Parsed image reference {registry, repository, digest, tag}
 * @throws {Error} - If image reference is invalid, uses mutable tag, or is not approved
 */
function validateImageReference(imageRef, platform = 'linux/amd64') {
  if (!imageRef || typeof imageRef !== 'string') {
    throw new Error('Image reference must be a non-empty string');
  }
  
  // Detect mutable tags
  for (const pattern of MUTABLE_TAG_PATTERNS) {
    if (pattern.test(imageRef)) {
      throw new Error(
        `Mutable tag detected in image reference: ${imageRef}. ` +
        `Only immutable digest references are allowed (e.g., mysql@sha256:...).`
      );
    }
  }
  
  // Parse image reference
  const parsed = parseImageReference(imageRef);
  
  // Validate registry and repository
  if (parsed.registry && parsed.registry !== 'docker.io') {
    throw new Error(
      `Unofficial registry detected: ${parsed.registry}. ` +
      `Only docker.io/library/mysql is approved.`
    );
  }
  
  if (parsed.repository !== 'mysql' && parsed.repository !== 'library/mysql') {
    throw new Error(
      `Unofficial repository: ${parsed.repository}. ` +
      `Only mysql (docker.io/library/mysql) is approved.`
    );
  }
  
  // Must have digest, not tag
  if (!parsed.digest) {
    throw new Error(
      `Image reference must use immutable digest, not tag. ` +
      `Got: ${imageRef}`
    );
  }
  
  // Check digest is approved
  isApprovedDigest(parsed.digest, platform);
  
  return parsed;
}

/**
 * Parse image reference into components.
 * 
 * @param {string} imageRef - Image reference string
 * @returns {object} - {registry, repository, digest, tag}
 */
function parseImageReference(imageRef) {
  const result = {
    registry: null,
    repository: null,
    digest: null,
    tag: null,
  };
  
  // Extract digest if present
  const digestMatch = imageRef.match(/@(sha256:[a-f0-9]{64})$/);
  if (digestMatch) {
    result.digest = digestMatch[1];
    imageRef = imageRef.substring(0, digestMatch.index);
  }
  
  // Extract tag if present (and no digest)
  if (!result.digest) {
    const tagMatch = imageRef.match(/:([^:/@]+)$/);
    if (tagMatch) {
      result.tag = tagMatch[1];
      imageRef = imageRef.substring(0, tagMatch.index);
    }
  }
  
  // Extract registry and repository
  const parts = imageRef.split('/');
  if (parts.length === 1) {
    // Just "mysql"
    result.repository = parts[0];
  } else if (parts.length === 2) {
    // "library/mysql" or "registry/mysql"
    if (parts[0].includes('.') || parts[0].includes(':')) {
      result.registry = parts[0];
      result.repository = parts[1];
    } else {
      result.repository = `${parts[0]}/${parts[1]}`;
    }
  } else {
    // "docker.io/library/mysql"
    result.registry = parts[0];
    result.repository = parts.slice(1).join('/');
  }
  
  return result;
}

/**
 * Detect MariaDB (not approved for this runner).
 * 
 * @param {string} versionComment - MySQL version comment string or image name
 * @returns {boolean} - True if MariaDB detected
 * @throws {Error} - If MariaDB is detected
 */
function detectMariaDB(versionComment) {
  if (!versionComment || typeof versionComment !== 'string') {
    return false;
  }
  
  const mariadbPatterns = [
    /mariadb/i,
    /maria-db/i,
    /maria db/i,
  ];
  
  for (const pattern of mariadbPatterns) {
    if (pattern.test(versionComment)) {
      throw new Error(
        `MariaDB detected in version comment: "${versionComment}". ` +
        `Only MySQL 8.4 is approved for trusted runner.`
      );
    }
  }
  
  return false;
}

/**
 * Reject mutable tag references.
 * 
 * @param {string} tag - Tag string to check
 * @throws {Error} - If tag is mutable
 */
function rejectMutableTag(tag) {
  const mutableTags = ['latest', '8.4', '8', ''];
  
  if (mutableTags.includes(tag)) {
    throw new Error(
      `Mutable tag detected: "${tag || '(empty)'}". ` +
      `Only immutable digest references are allowed.`
    );
  }
}

/**
 * Validate platform is supported.
 * 
 * @param {string} platform - Platform identifier
 * @throws {Error} - If platform is not supported
 */
function validatePlatform(platform) {
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(
      `Unsupported platform: ${platform}. ` +
      `Valid platforms: ${Array.from(VALID_PLATFORMS).join(', ')}`
    );
  }
}

module.exports = {
  isApprovedDigest,
  validateImageReference,
  detectMariaDB,
  rejectMutableTag,
  validatePlatform,
  validateDigestFormat,
  parseImageReference,
};
