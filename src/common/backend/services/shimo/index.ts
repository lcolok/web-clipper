import { ServiceMeta } from '@/common/backend';
import Service from './service';
import localeService from '@/common/locales';

export default (): ServiceMeta => {
  return {
    name: localeService.format({
      id: 'backend.services.shimo.name',
      defaultMessage: 'Shimo',
    }),
    icon: 'https://www.notion.so/images/favicon.ico',
    type: 'shimo',
    homePage: 'https://www.notion.so/',
    service: Service,
  };
};
