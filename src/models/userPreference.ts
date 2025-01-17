import Axios from 'axios';
import React from 'react';
import { getLanguage } from './../common/locales';
import localeService from '@/common/locales';
import { LOCAL_USER_PREFERENCE_LOCALE_KEY } from './../common/modelTypes/userPreference';
import { runScript } from './../browser/actions/message';
import storage from 'common/storage';
import * as antd from 'antd';
import { GlobalStore } from '@/common/types';
import browserService from 'common/browser';
import * as browser from '@web-clipper/chrome-promise';
import { hideTool, removeTool } from 'browserActions/message';
import update from 'immutability-helper';
import {
  asyncSetEditorLiveRendering,
  asyncSetShowLineNumber,
  initUserPreference,
  asyncDeleteImageHosting,
  asyncAddImageHosting,
  asyncEditImageHosting,
  asyncHideTool,
  asyncRemoveTool,
  asyncRunExtension,
  setLocale,
  asyncSetLocaleToStorage,
  initServices,
  asyncFetchRemoteConfig,
} from 'pageActions/userPreference';
import { initTabInfo, changeData, asyncChangeAccount } from 'pageActions/clipper';
import { DvaModelBuilder, removeActionNamespace } from 'dva-model-creator';
import { UserPreferenceStore } from 'common/types';
import { getServices, getImageHostingServices, imageHostingServiceFactory } from 'common/backend';
import { ToolContext } from '@web-clipper/extensions';
import backend from 'common/backend/index';
import { loadImage } from 'common/blob';
import { routerRedux } from 'dva';
import { localStorageService, syncStorageService } from '@/common/chrome/storage';
import { loadExtensions } from '@/actions/extension';
import { initAccounts } from '@/actions/account';
import iconConfig from '@/../config.json';
import copyToClipboard from 'copy-to-clipboard';

const { message } = antd;

const defaultState: UserPreferenceStore = {
  locale: getLanguage(),
  imageHosting: [],
  servicesMeta: {},
  imageHostingServicesMeta: {},
  showLineNumber: true,
  liveRendering: true,
  iconfontUrl: '',
  iconfontIcons: [],
};

const builder = new DvaModelBuilder(defaultState, 'userPreference')
  .case(asyncSetShowLineNumber.done, (state, { result: { value: showLineNumber } }) => ({
    ...state,
    showLineNumber,
  }))
  .case(asyncSetEditorLiveRendering.done, (state, { result: { value: liveRendering } }) => ({
    ...state,
    liveRendering,
  }))
  .case(initUserPreference, (state, payload) => ({
    ...state,
    ...payload,
  }))
  .case(asyncDeleteImageHosting.done, (state, { result }) =>
    update(state, {
      imageHosting: {
        $set: result,
      },
    })
  )
  .case(asyncAddImageHosting.done, (state, { result }) =>
    update(state, {
      imageHosting: {
        $set: result,
      },
    })
  )
  .case(asyncEditImageHosting.done, (state, { result }) =>
    update(state, {
      imageHosting: {
        $set: result,
      },
    })
  );

builder
  .takeEvery(asyncFetchRemoteConfig.started, function*(_, { call, put }) {
    let iconfont = iconConfig.iconfont;
    if (process.env.NODE_ENV !== 'development') {
      const response = yield call(
        Axios.get,
        'https://api.github.com/repos/webclipper/web-clipper/contents/config.json'
      );
      const data = decodeURIComponent(escape(window.atob(response.data.content)));
      iconfont = JSON.parse(data).iconfont;
    }

    let icons: string[] = [];
    try {
      const iconsFile = yield call(Axios.get, iconfont);
      const matchResult: string[] = iconsFile.data.match(/id="([A-Za-z]+)"/g) || [];
      icons = matchResult.map(o => o.match(/id="([A-Za-z]+)"/)![1]);
    } catch (error) {
      console.log(error);
    }
    yield put(asyncFetchRemoteConfig.done({ result: { iconfont, icons } }));
  })
  .case(asyncFetchRemoteConfig.done, (s, { result: { iconfont, icons } }) => {
    return {
      ...s,
      iconfontUrl: iconfont,
      iconfontIcons: icons,
    };
  });

builder
  .takeEvery(asyncSetShowLineNumber.started, function*(payload, { call, put }) {
    const { value } = payload;
    yield call(storage.setShowLineNumber, !value);
    yield put(
      asyncSetShowLineNumber.done({
        params: {
          value,
        },
        result: {
          value: !value,
        },
      })
    );
  })
  .takeEvery(asyncSetEditorLiveRendering.started, function*({ value }, { call, put }) {
    yield call(storage.setLiveRendering, !value);
    yield put(
      asyncSetEditorLiveRendering.done({
        params: {
          value,
        },
        result: {
          value: !value,
        },
      })
    );
  })
  .takeEvery(asyncHideTool.started, function*(_, { call }) {
    yield call(browserService.sendActionToCurrentTab, hideTool());
  })
  .takeEvery(asyncRemoveTool.started, function*(_, { call }) {
    yield call(browserService.sendActionToCurrentTab, removeTool());
  })
  .takeEvery(asyncEditImageHosting.started, function*(payload, { call, put }) {
    const { id, value, closeModal } = payload;
    try {
      const imageHostingList = yield call(storage.editImageHostingById, id, {
        ...value,
        id,
      });
      yield put(
        asyncEditImageHosting.done({
          params: payload,
          result: imageHostingList,
        })
      );
      closeModal();
    } catch (error) {
      message.error(error.message);
    }
  })
  .takeEvery(asyncDeleteImageHosting.started, function*(payload, { call, put }) {
    const imageHostingList: PromiseType<
      ReturnType<typeof storage.deleteImageHostingById>
    > = yield call(storage.deleteImageHostingById, payload.id);
    yield put(
      asyncDeleteImageHosting.done({
        params: payload,
        result: imageHostingList,
      })
    );
  })
  .takeEvery(asyncAddImageHosting.started, function*(payload, { call, put }) {
    const { info, type, closeModal, remark } = payload;
    const imageHostingService: ReturnType<typeof imageHostingServiceFactory> = yield call(
      imageHostingServiceFactory,
      type,
      info
    );
    if (!imageHostingService) {
      message.error('不支持');
      return;
    }
    const id = imageHostingService.getId();
    const imageHosting = {
      id,
      type,
      info,
      remark,
    };
    try {
      const imageHostingList: PromiseType<ReturnType<typeof storage.addImageHosting>> = yield call(
        storage.addImageHosting,
        imageHosting
      );
      yield put(
        asyncAddImageHosting.done({
          params: payload,
          result: imageHostingList,
        })
      );
      closeModal();
    } catch (error) {
      message.error(error.message);
    }
  })
  .takeEvery(asyncRunExtension.started, function*({ extension, pathname }, { call, put, select }) {
    let result;
    const { run, afterRun, destroy } = extension;
    if (run) {
      result = yield call(browserService.sendActionToCurrentTab, runScript(run));
    }
    const state: GlobalStore = yield select(state => state);
    const data = state.clipper.clipperData[pathname];

    function createAndDownloadFile(fileName: string, content: string | Blob) {
      let aTag = document.createElement('a');
      let blob: Blob;
      if (typeof content === 'string') {
        blob = new Blob([content]);
      } else {
        blob = content;
      }
      aTag.download = fileName;
      aTag.href = URL.createObjectURL(blob);
      aTag.click();
      URL.revokeObjectURL(aTag.href);
    }

    if (afterRun) {
      result = yield (async () => {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const context: ToolContext<any, any> = {
          locale: state.userPreference.locale,
          result,
          data,
          message,
          imageService: backend.getImageHostingService(),
          loadImage: loadImage,
          captureVisibleTab: browserService.captureVisibleTab,
          copyToClipboard,
          createAndDownloadFile,
          antd,
          React,
        };
        // eslint-disable-next-line
        return await eval(afterRun);
      })();
    }
    if (destroy) {
      yield call(browserService.sendActionToCurrentTab, runScript(destroy));
    }
    yield put(
      changeData({
        data: result,
        pathName: pathname,
      })
    );
  });

builder.subscript(async function initStore({ dispatch, history }) {
  await dispatch(initAccounts.started());
  dispatch(asyncFetchRemoteConfig.started());
  const result = await storage.getPreference();
  const tabInfo = await browser.tabs.getCurrent();
  if (tabInfo.title && tabInfo.url) {
    dispatch(initTabInfo({ title: tabInfo.title, url: tabInfo.url }));
  }
  dispatch(removeActionNamespace(initUserPreference(result)));
  if (history.location.pathname !== '/') {
    return;
  }
  if (result.defaultPluginId) {
    dispatch(routerRedux.push(`/plugins/${result.defaultPluginId}`));
  }
  const defaultAccountId = syncStorageService.get('defaultAccountId');
  if (defaultAccountId) {
    dispatch(asyncChangeAccount.started({ id: defaultAccountId }));
  }
});

builder
  .takeEvery(asyncSetLocaleToStorage, function*(locale, { call }) {
    yield call(localStorageService.set, LOCAL_USER_PREFERENCE_LOCALE_KEY, locale);
  })
  .subscript(async function initLocal({ dispatch }) {
    const locale = localStorageService.get(LOCAL_USER_PREFERENCE_LOCALE_KEY, navigator.language);
    dispatch(removeActionNamespace(setLocale(locale)));
    localStorageService.onDidChangeStorage(key => {
      if (key === LOCAL_USER_PREFERENCE_LOCALE_KEY) {
        dispatch(
          removeActionNamespace(
            setLocale(localStorageService.get(LOCAL_USER_PREFERENCE_LOCALE_KEY, navigator.language))
          )
        );
        dispatch(loadExtensions.started());
      }
    });
  })
  .case(setLocale, (state, locale) => ({ ...state, locale }));

builder
  .subscript(async function xx({ dispatch }) {
    const servicesMeta = getServices().reduce(
      (previousValue, meta) => {
        previousValue[meta.type] = meta;
        return previousValue;
      },
      {} as UserPreferenceStore['servicesMeta']
    );

    const imageHostingServicesMeta = getImageHostingServices().reduce(
      (previousValue, meta) => {
        previousValue[meta.type] = meta;
        return previousValue;
      },
      {} as UserPreferenceStore['imageHostingServicesMeta']
    );
    dispatch(
      removeActionNamespace(
        initServices({
          imageHostingServicesMeta,
          servicesMeta,
        })
      )
    );

    localStorageService.onDidChangeStorage(async key => {
      if (key === LOCAL_USER_PREFERENCE_LOCALE_KEY) {
        await localeService.init();
        const servicesMeta = getServices().reduce(
          (previousValue, meta) => {
            previousValue[meta.type] = meta;
            return previousValue;
          },
          {} as UserPreferenceStore['servicesMeta']
        );
        const imageHostingServicesMeta = getImageHostingServices().reduce(
          (previousValue, meta) => {
            previousValue[meta.type] = meta;
            return previousValue;
          },
          {} as UserPreferenceStore['imageHostingServicesMeta']
        );
        dispatch(
          removeActionNamespace(
            initServices({
              imageHostingServicesMeta,
              servicesMeta,
            })
          )
        );
      }
    });
  })
  .case(initServices, (state, { imageHostingServicesMeta, servicesMeta }) => {
    return {
      ...state,
      imageHostingServicesMeta,
      servicesMeta,
    };
  });

export default builder.build();
