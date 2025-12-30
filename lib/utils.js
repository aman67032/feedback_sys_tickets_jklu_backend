// Utility functions for the backend

/**
 * Convert snake_case object keys to camelCase
 * @param {Object} obj - Object with snake_case keys
 * @returns {Object} - Object with camelCase keys
 */
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamelCase(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => convertKeysToCamelCase(item));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const converted = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const camelKey = snakeToCamel(key);
      converted[camelKey] = convertKeysToCamelCase(obj[key]);
    }
  }
  return converted;
}

module.exports = {
  convertKeysToCamelCase,
  snakeToCamel
};

