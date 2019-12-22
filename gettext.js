const translations = {
    ru: {
        'Loading…': 'Загрузка…',
        'Back': 'Назад',
        'Archive is empty.': 'Архив пуст.',
        'Comments by ': 'Комментарии ',
        'User ID or handle (for example, “1” or “durov”):': 'ID пользователя или адрес страницы (например, “1” или “durov”):',
        'Public list (IDs or handles); separate with commas, spaces or line feeds:': 'Список пабликов (ID или адреса страниц); разделяйте запятыми, пробелами или переводами строки:',
        'Fill with user subscriptions': 'Заполнить подписками пользователя',
        'Time limit, days:': 'Ограничение по времени, в днях:',
        'Find!': 'Найти!',
        'Archive': 'Архив',
        'Hello! This app can find posts made by a specific user.': 'Привет! Это — приложение для поиска комментариев определённого пользователя.',
        'It uses the execute() method, which allows checking 25 posts per request': 'Оно использует метод “execute()”, который позволяет проверять 25 постов за один запрос.',
        'We are being too fast ({0})': 'Умерим пыл ({0})',
        'Getting server time…': 'Получаю время сервера…',
        'Checking user…': 'Проверяю пользователя…',
        'Checking public list…': 'Проверяю список пабликов…',
        'Gathering statistics…': 'Собираю статистику…',
        'Searching in {0}/{1}…': 'Ищу в {0}/{1}…',
        '  (found {0})': ' (найдено {0})',
        'Found: {0}': 'Найдено: {0}',
        'Error checking {0}: {1}': 'Ошибка при проверке {0}: {1}',
        'Saving results…': 'Сохраняю результаты…',
        'No subscriptions found!': 'Подписок не найдено!',
        'Error: {0}': 'Ошибка: {0}',
        'Loading…': 'Загрузка…',
        'Cancel': 'Отмена',
        'Nothing found! 😢': 'Ничего не найдено! 😢',
        'Posts founds:': 'Найдены посты:',
        ' (new)': ' (новый)',
        ' (old)': ' (старый)',
    },
};

const selectTranslation = (langTag) => {
    if (typeof(langTag) !== 'string')
        return undefined;
    const m = langTag.match(/^[a-zA-Z]+/);
    if (m === null)
        return undefined;
    return translations[m[0]];
};

const translation = selectTranslation(navigator.language || navigator.userLanguage) || {};

export const __ = (text, ...args) => {
    let pattern = translation[text];
    if (pattern === undefined)
        pattern = text;
    return pattern.replace(/{([0-9]+)}/g, (m) => args[m[1]]);
};
