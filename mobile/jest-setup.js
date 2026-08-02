import '@testing-library/jest-native/extend-expect';
import 'react-native-gesture-handler/jestSetup';

global.__reanimatedWorkletInit = () => {};

global.alert = () => {};
