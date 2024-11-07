(function WriteBackAction(parm_input, parm_variable) {
	// Check if the scan date is populated, if not, fill it
	// Move the status of the Asset Audit from 'New' to 'In Progress'
	var currentAssetAuditInfo = new global.GlideQuery('sn_hamp_asset_audit')
		.where('sys_id', parm_variable.sys_id)
		.selectOne('scan_date', 'location', 'stockroom', 'expected', 'not_expected', 'new', 'not_found','excluded', 'type' , 'status', 'assigned_to')
		.get();
	var currentScanDate = new GlideDate();
	new global.GlideQuery('sn_hamp_asset_audit')
		.where('sys_id',  currentAssetAuditInfo.sys_id)
		.update({scan_date: currentScanDate});
	
	currentAssetAuditInfo.scan_date = currentScanDate;
	var eamModelExt = HAMUtils.getEAMModelClasses();
	var eamAssetExt = HAMUtils.getEAMAssetClasses();
	if (currentAssetAuditInfo.status === 'new') {
			new global.GlideQuery('sn_hamp_asset_audit')
				.where('sys_id',  currentAssetAuditInfo.sys_id)
				.update({status: 'in_progress'});
		
			currentAssetAuditInfo.status = 'in_progress';
			
			var assetGR = new GlideRecord('alm_asset');
			// remove excluded assets from expected count
			assetGR.addQuery('excluded_from_ham', 'false');
			if(currentAssetAuditInfo.type === 'stockroom'){
				assetGR.addQuery('stockroom', currentAssetAuditInfo.stockroom);
			} else {
				assetGR.addQuery('location', currentAssetAuditInfo.location);
			}
			assetGR.addQuery('model_category', '!=', '218323293743100044e0bfc8bcbe5d61');
			if(sn_hamp.HAMUtils.HAS_ONLY_TNI_ENTITLEMENT) {
				assetGR.addQuery('model_category', 'IN', sn_hamp.HAMUtils.getEntitledTNIModelCategories());
			}
			assetGR.addQuery('model.sys_class_name', 'NOT IN', eamModelExt);
			assetGR.addQuery('sys_class_name', 'NOT IN', eamAssetExt);
			assetGR.query();
			while (assetGR.next()) {
				var auditToAssetGR = new GlideRecord('sn_hamp_m2m_audit_asset');
				auditToAssetGR.initialize();
				auditToAssetGR.asset_audit = currentAssetAuditInfo.sys_id;
				auditToAssetGR.asset = assetGR.sys_id;
				auditToAssetGR.audit_status = 'not_found';
				auditToAssetGR.insert();
			}
		
	}
	
	//Asset Tag processing
	if (parm_input.asset_tags != undefined) {
	for (var index = 0; index < parm_input.asset_tags.length; index+=1) {
		var assetTag = parm_input.asset_tags[index];

		var excludedAssetGr = new GlideRecord('alm_asset');
		excludedAssetGr.addQuery('asset_tag', assetTag);
		if(sn_hamp.HAMUtils.HAS_ONLY_TNI_ENTITLEMENT) {
				excludedAssetGr.addQuery('model_category', 'IN', sn_hamp.HAMUtils.getEntitledTNIModelCategories());
			}
		var qr = excludedAssetGr.addQuery('excluded_from_ham', true);
		qr.addOrCondition('model.sys_class_name', 'IN', eamModelExt).addOrCondition('sys_class_name', 'IN', eamAssetExt);
		excludedAssetGr.query();

		if (excludedAssetGr.next()) {
			// check if sn_hamp_m2m_audit_asset is present
			var excludedAssetM2M = new global.GlideQuery('sn_hamp_m2m_audit_asset')
			.where('asset_audit', currentAssetAuditInfo.sys_id)
			.where('asset.asset_tag',assetTag)
			.select('sys_id')
			.toArray(1);
			if (excludedAssetM2M && excludedAssetM2M[0]) {	
				new global.GlideQuery('sn_hamp_m2m_audit_asset')
					.where('sys_id',  excludedAssetM2M[0].sys_id)
					.update({'audit_status': 'excluded', 'scanned': true});
			} else {
				new global.GlideQuery('sn_hamp_m2m_audit_asset')
					.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: excludedAssetGr.sys_id, audit_status: 'excluded', sys_domain: excludedAssetGr.sys_domain});
			}
		} else {
			// Only audit assets that haven't been scanned during this audit yet
			var currentAssetCount = new global.GlideQuery('alm_asset')
				.where('asset_tag', assetTag)
				.where('audit_number', currentAssetAuditInfo.sys_id)
				.count();
	
			if (currentAssetCount === 0) {
				// Update the status to expected if the asset_tag is in sn_hamp_m2m_audit_asset
				var info = new global.GlideQuery('sn_hamp_m2m_audit_asset')
				.where('asset_audit', currentAssetAuditInfo.sys_id)
				.where('asset.asset_tag',assetTag)
				.select('sys_id')
				.toArray(1);

				if (info && info[0]){
					var expectedAsset = new global.GlideQuery('alm_asset')
						.where('asset_tag', assetTag)
						.selectOne('sys_id')
						.get();
					
					var expectedAssetDomain = new global.GlideQuery('alm_asset').get(expectedAsset.sys_id, ['sys_domain']);
					
					new global.GlideQuery('sn_hamp_m2m_audit_asset')
						.where('sys_id',  info[0].sys_id)
						.update({'audit_status': 'expected', 'scanned': true, 'sys_domain': expectedAssetDomain._value.sys_domain});

						new global.GlideQuery('alm_asset')
							.where('sys_id', expectedAsset.sys_id)
							.update({audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status});
				} else {

					// If the update fails the asset we are looking for isn't in sn_hamp_m2m_audit_asset, so insert
					// in a new record with the following logic for calculating its status:

					// if an asset with the current asset tag is in alm_asset, its audit status will be 'not expected'
					// we will update the asset's location to the current location

					// if  an asset with the current asset tag is not in alm_asset, its audit status will be set to 'new'

					var assetTagCountGA = new GlideAggregate('alm_asset');
					assetTagCountGA.addQuery('asset_tag', assetTag);
					assetTagCountGA.addAggregate('COUNT');
					assetTagCountGA.query();
					assetTagCountGA.next();

					if (assetTagCountGA.getAggregate('COUNT') > 0){
						var asset = new global.GlideQuery('alm_asset')
							.where('asset_tag', assetTag)
							.selectOne('sys_id', 'model_category')
							.get();
						var updateFlag = true;
						if(sn_hamp.HAMUtils.HAS_ONLY_TNI_ENTITLEMENT && sn_hamp.HAMUtils.getEntitledTNIModelCategories().indexOf(asset.model_category) === -1) {
							updateFlag = false;
						}
						if(updateFlag) {
							var assetDomain = new global.GlideQuery('alm_asset').get(asset.sys_id, ['sys_domain']);
							// Update the asset's stockroom OR location based on the type of the audit
							if (currentAssetAuditInfo.type === 'stockroom') {
								new global.GlideQuery('alm_asset')
									.where('sys_id', asset.sys_id) 
									.update({stockroom: currentAssetAuditInfo.stockroom, location: currentAssetAuditInfo.location, audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status, install_status: 6}); 
							} else {
								// If the asset is tagged against a stockroom and its stockroom's location doesn't match the location 
								// of the audit, then clear out its stockroom.
								var assetStockroomInfo = new global.GlideQuery('alm_asset') 
									.where('sys_id', asset.sys_id ) 
									.selectOne('stockroom.location') 
									.ifPresent(
										function(assetStockroomInfo) {
											if (assetStockroomInfo.stockroom && assetStockroomInfo.stockroom.location !== currentAssetAuditInfo.location) { 
												new global.GlideQuery('alm_asset') 
													.where('sys_id', asset.sys_id) 
													.update({stockroom: null});
											}
										}
									);
								new global.GlideQuery('alm_asset') 
									.where('sys_id', asset.sys_id) 
									.update({location: currentAssetAuditInfo.location, audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status}); 
							}
							new global.GlideQuery('sn_hamp_m2m_audit_asset')
								.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: asset.sys_id, audit_status: 'not_expected', sys_domain: assetDomain._value.sys_domain});
						}
					} else {
						// Set to the special model and model category, Unknown
						var unknownModel = '3410e2c100a70010fa9b161c34f87377';
						var unknownModelCategory = '2ffe9a8100a70010fa9b161c34f873cd';
						var newAsset;
						var assetJson = {
							asset_tag: assetTag,
							model: unknownModel,
							model_category: unknownModelCategory,
							audit_number: currentAssetAuditInfo.sys_id,
							last_audit_date: currentAssetAuditInfo.scan_date,
							audited_by: currentAssetAuditInfo.assigned_to,
							audit_type: currentAssetAuditInfo.type,
							last_audit_state: currentAssetAuditInfo.status,
							location: currentAssetAuditInfo.location
						};
						if (currentAssetAuditInfo.type === 'stockroom') {
							assetJson['stockroom'] = currentAssetAuditInfo.stockroom;
							assetJson['install_status'] = parseInt(HAMConstants.ASSET_STATUSES.IN_STOCK,10);
							assetJson['substatus'] = HAMConstants.ASSET_SUB_STATUSES.AVAILABLE;
						} else {
							assetJson['install_status'] = parseInt(HAMConstants.ASSET_STATUSES.IN_USE,10);
						}
						newAsset = new global.GlideQuery('alm_hardware').insert(assetJson).get();
						new global.GlideQuery('sn_hamp_m2m_audit_asset')
							.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: newAsset.sys_id, audit_status: 'new'});
					}
				}
			}
		}
	}
}

	//Serial Number processing
	if (parm_input.serial_numbers != undefined) {
	for (var index = 0; index < parm_input.serial_numbers.length; index+=1) {
		var SerialNumber = parm_input.serial_numbers[index];

		var excludedAssetGr = new GlideRecord('alm_asset');
		excludedAssetGr.addQuery('serial_number', SerialNumber);
		if(sn_hamp.HAMUtils.HAS_ONLY_TNI_ENTITLEMENT) {
				excludedAssetGr.addQuery('model_category', 'IN', sn_hamp.HAMUtils.getEntitledTNIModelCategories());
			}
		var qr = excludedAssetGr.addQuery('excluded_from_ham', true);
		qr.addOrCondition('model.sys_class_name', 'IN', eamModelExt).addOrCondition('sys_class_name', 'IN', eamAssetExt);
		excludedAssetGr.query();

		if (excludedAssetGr.next()) {
			// check if sn_hamp_m2m_audit_asset is present
			var excludedAssetM2M = new global.GlideQuery('sn_hamp_m2m_audit_asset')
			.where('asset_audit', currentAssetAuditInfo.sys_id)
			.where('asset.serial_number',SerialNumber)
			.select('sys_id')
			.toArray(1);
			if (excludedAssetM2M && excludedAssetM2M[0]) {	
				new global.GlideQuery('sn_hamp_m2m_audit_asset')
					.where('sys_id',  excludedAssetM2M[0].sys_id)
					.update({'audit_status': 'excluded', 'scanned': true});
			} else {
				new global.GlideQuery('sn_hamp_m2m_audit_asset')
					.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: excludedAssetGr.sys_id, audit_status: 'excluded', sys_domain: excludedAssetGr.sys_domain});
			}
		} else {
			// Only audit assets that haven't been scanned during this audit yet
			var currentAssetCount = new global.GlideQuery('alm_asset')
				.where('serial_number', SerialNumber)
				.where('audit_number', currentAssetAuditInfo.sys_id)
				.count();
	
			if (currentAssetCount === 0) {
				// Update the status to expected if the serial_number is in sn_hamp_m2m_audit_asset
				var info = new global.GlideQuery('sn_hamp_m2m_audit_asset')
				.where('asset_audit', currentAssetAuditInfo.sys_id)
				.where('asset.serial_number',SerialNumber)
				.select('sys_id')
				.toArray(1);

				if (info && info[0]){
					var expectedAsset = new global.GlideQuery('alm_asset')
						.where('serial_number', SerialNumber)
						.selectOne('sys_id')
						.get();
					
					var expectedAssetDomain = new global.GlideQuery('alm_asset').get(expectedAsset.sys_id, ['sys_domain']);
					
					new global.GlideQuery('sn_hamp_m2m_audit_asset')
						.where('sys_id',  info[0].sys_id)
						.update({'audit_status': 'expected', 'scanned': true, 'sys_domain': expectedAssetDomain._value.sys_domain});

						new global.GlideQuery('alm_asset')
							.where('sys_id', expectedAsset.sys_id)
							.update({audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status});
				} else {

					// If the update fails the asset we are looking for isn't in sn_hamp_m2m_audit_asset, so insert
					// in a new record with the following logic for calculating its status:

					// if an asset with the current asset tag is in alm_asset, its audit status will be 'not expected'
					// we will update the asset's location to the current location

					// if  an asset with the current asset tag is not in alm_asset, its audit status will be set to 'new'

					var SerialNumberCountGA = new GlideAggregate('alm_asset');
					SerialNumberCountGA.addQuery('serial_number', SerialNumber);
					SerialNumberCountGA.addAggregate('COUNT');
					SerialNumberCountGA.query();
					SerialNumberCountGA.next();

					if (SerialNumberCountGA.getAggregate('COUNT') > 0){
						var asset = new global.GlideQuery('alm_asset')
							.where('serial_number', SerialNumber)
							.selectOne('sys_id', 'model_category')
							.get();
						var updateFlag = true;
						if(sn_hamp.HAMUtils.HAS_ONLY_TNI_ENTITLEMENT && sn_hamp.HAMUtils.getEntitledTNIModelCategories().indexOf(asset.model_category) === -1) {
							updateFlag = false;
						}
						if(updateFlag) {
							var assetDomain = new global.GlideQuery('alm_asset').get(asset.sys_id, ['sys_domain']);
							// Update the asset's stockroom OR location based on the type of the audit
							if (currentAssetAuditInfo.type === 'stockroom') {
								new global.GlideQuery('alm_asset')
									.where('sys_id', asset.sys_id) 
									.update({stockroom: currentAssetAuditInfo.stockroom, location: currentAssetAuditInfo.location, audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status, install_status: 6}); 
							} else {
								// If the asset is tagged against a stockroom and its stockroom's location doesn't match the location 
								// of the audit, then clear out its stockroom.
								var assetStockroomInfo = new global.GlideQuery('alm_asset') 
									.where('sys_id', asset.sys_id ) 
									.selectOne('stockroom.location') 
									.ifPresent(
										function(assetStockroomInfo) {
											if (assetStockroomInfo.stockroom && assetStockroomInfo.stockroom.location !== currentAssetAuditInfo.location) { 
												new global.GlideQuery('alm_asset') 
													.where('sys_id', asset.sys_id) 
													.update({stockroom: null});
											}
										}
									);
								new global.GlideQuery('alm_asset') 
									.where('sys_id', asset.sys_id) 
									.update({location: currentAssetAuditInfo.location, audit_number: currentAssetAuditInfo.sys_id, last_audit_date: currentAssetAuditInfo.scan_date, audited_by: currentAssetAuditInfo.assigned_to, audit_type: currentAssetAuditInfo.type, last_audit_state: currentAssetAuditInfo.status}); 
							}
							new global.GlideQuery('sn_hamp_m2m_audit_asset')
								.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: asset.sys_id, audit_status: 'not_expected', sys_domain: assetDomain._value.sys_domain});
						}
					} else {
						// Set to the special model and model category, Unknown
						var unknownModel = '3410e2c100a70010fa9b161c34f87377';
						var unknownModelCategory = '2ffe9a8100a70010fa9b161c34f873cd';
						var newAsset;
						var assetJson = {
							serial_number: SerialNumber,
							model: unknownModel,
							model_category: unknownModelCategory,
							audit_number: currentAssetAuditInfo.sys_id,
							last_audit_date: currentAssetAuditInfo.scan_date,
							audited_by: currentAssetAuditInfo.assigned_to,
							audit_type: currentAssetAuditInfo.type,
							last_audit_state: currentAssetAuditInfo.status,
							location: currentAssetAuditInfo.location
						};
						if (currentAssetAuditInfo.type === 'stockroom') {
							assetJson['stockroom'] = currentAssetAuditInfo.stockroom;
							assetJson['install_status'] = parseInt(HAMConstants.ASSET_STATUSES.IN_STOCK,10);
							assetJson['substatus'] = HAMConstants.ASSET_SUB_STATUSES.AVAILABLE;
						} else {
							assetJson['install_status'] = parseInt(HAMConstants.ASSET_STATUSES.IN_USE,10);
						}
						newAsset = new global.GlideQuery('alm_hardware').insert(assetJson).get();
						new global.GlideQuery('sn_hamp_m2m_audit_asset')
							.insert({asset_audit: currentAssetAuditInfo.sys_id, scanned: true, asset: newAsset.sys_id, audit_status: 'new'});
					}
				}
			}
		}
	}
}
	// Just recalculate the four counts at the end so that we avoid bugs in weird scenarios like
	// (a) multiple scans of the same asset tag
	var notFoundCountGA = new GlideAggregate('sn_hamp_m2m_audit_asset');
	notFoundCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	notFoundCountGA.addQuery('audit_status', 'not_found');
	notFoundCountGA.addAggregate('COUNT');
	notFoundCountGA.query();
	notFoundCountGA.next();
	var notFoundCount = notFoundCountGA.getAggregate('COUNT');
	
	var expectedCountGA = new GlideAggregate('sn_hamp_m2m_audit_asset');
	expectedCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	expectedCountGA.addQuery('audit_status', 'expected');
	expectedCountGA.addAggregate('COUNT');
	expectedCountGA.query();
	expectedCountGA.next();
	var expectedCount = expectedCountGA.getAggregate('COUNT');
	
	var notExpectedCountGA = new GlideAggregate('sn_hamp_m2m_audit_asset');
	notExpectedCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	notExpectedCountGA.addQuery('audit_status', 'not_expected');
	notExpectedCountGA.addAggregate('COUNT');
	notExpectedCountGA.query();
	notExpectedCountGA.next();
	var notExpectedCount = notExpectedCountGA.getAggregate('COUNT');
	
	var newCountGA =  new GlideAggregate('sn_hamp_m2m_audit_asset');
	newCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	newCountGA.addQuery('audit_status', 'new');
	newCountGA.addAggregate('COUNT');
	newCountGA.query();
	newCountGA.next();
	var newCount = newCountGA.getAggregate('COUNT');

	var excludedCountGA =  new GlideAggregate('sn_hamp_m2m_audit_asset');
	excludedCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	excludedCountGA.addQuery('audit_status', 'excluded');
	excludedCountGA.addAggregate('COUNT');
	excludedCountGA.query();
	excludedCountGA.next();
	var excludedCount = excludedCountGA.getAggregate('COUNT');
	
	var excludedCountGA =  new GlideAggregate('sn_hamp_m2m_audit_asset');
	excludedCountGA.addQuery('asset_audit', currentAssetAuditInfo.sys_id);
	excludedCountGA.addQuery('audit_status', 'excluded');
	excludedCountGA.addAggregate('COUNT');
	excludedCountGA.query();
	excludedCountGA.next();
	var excludedCount = excludedCountGA.getAggregate('COUNT');
	
	var assetAuditGR = new GlideRecord('sn_hamp_asset_audit');
	assetAuditGR.get(currentAssetAuditInfo.sys_id);
	assetAuditGR.expected = expectedCount;
	assetAuditGR.not_expected = notExpectedCount;
	assetAuditGR.setValue('new' ,parseInt(newCount)); 
	assetAuditGR.not_found = notFoundCount;
	assetAuditGR.excluded = excludedCount;
	assetAuditGR.update();
})(parm_input, parm_variable);