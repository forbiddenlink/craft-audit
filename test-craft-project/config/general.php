<?php

use craft\config\GeneralConfig;

return GeneralConfig::create()
    ->defaultWeekStartDay(1)
    ->omitScriptNameInUrls()
    ->devMode(true)
    ->allowAdminChanges(true)
    ->disallowRobots(true);
