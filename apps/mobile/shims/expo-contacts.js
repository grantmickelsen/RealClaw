// expo-contacts uses native APIs (Contacts framework) unavailable in web browsers.
module.exports = {
  requestPermissionsAsync: async () => ({ status: 'denied' }),
  getContactsAsync: async () => ({ data: [] }),
  presentContactPickerAsync: async () => null,
};
