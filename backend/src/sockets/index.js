/**
 * Socket.IO utility module
 * Provides access to the global Socket.IO instance
 */

function getIo() {
  return global.io || null;
}

module.exports = {
  getIo
};
