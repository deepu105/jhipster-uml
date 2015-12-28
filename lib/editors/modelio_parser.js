'use strict';

var _s = require('underscore.string'),
    AbstractParser = require('./abstract_parser'),
    parser_helper = require('./parser_helper'),
    InvalidTypeException = require('../exceptions/invalid_type_exception'),
    NullPointerException = require('../exceptions/null_pointer_exception'),
    NoValidationNameException = require('../exceptions/no_validation_name_exception'),
    WrongValidationException = require('../exceptions/wrong_validation_exception'),
    NoTypeException = require('../exceptions/no_type_exception');

/**
 * The parser for Modelio files.
 */
var ModelioParser = module.exports = function(root, databaseTypes) {
  AbstractParser.call(this, root, databaseTypes);
};

ModelioParser.prototype = Object.create(AbstractParser.prototype);
ModelioParser.prototype.constructor = AbstractParser;

ModelioParser.prototype.parse = function() {
  this.findElements();
  this.findConstraints();
  this.fillTypes();
  this.fillEnums();
  this.fillAssociations();
  this.fillClassesAndFields();
  this.fillConstraints();
  return this.parsedData;
};

ModelioParser.prototype.findElements = function() {
  this.root.packagedElement.forEach(function(element, index) {
    switch (element.$['xmi:type']) {
      case 'uml:PrimitiveType':
        this.rawTypesIndexes.push(index);
        break;
      case 'uml:Enumeration':
        this.rawEnumsIndexes.push(index);
        break;
      case 'uml:Class':
        this.rawClassesIndexes.push(index);
        break;
      case 'uml:Association':
        this.rawAssociationsIndexes.push(index);
        break;
      case 'uml:Package':
        this.extractDataFromPackage(index);
        break;
      default:
    }
  }, this);
};

ModelioParser.prototype.findConstraints = function() {
  if (!this.root.ownedRule) {
    return;
  }
  this.rawValidationRulesIndexes = this.root.ownedRule.map(function(element, index) {
    if (element.$['xmi:type'] === 'uml:Constraint') {
      return index;
    }
  });
};

ModelioParser.prototype.fillTypes = function() {
  this.rawTypesIndexes.forEach(function(element) {
    var type = this.root.packagedElement[element];
    this.addType(_s.capitalize(type.$.name), type.$['xmi:id']);
  }, this);
};

ModelioParser.prototype.addType = function(typeName, typeId) {
  if (!this.databaseTypes.contains(typeName)) {
    throw new InvalidTypeException(
      "The type '"
      + typeName
      + "' isn't supported by JHipster, exiting now.");
  }
  this.parsedData.addType(typeId, { name: typeName });
};

ModelioParser.prototype.fillEnums = function() {
  this.rawEnumsIndexes.forEach(function(index) {
    var enumElement = this.root.packagedElement[index];
    if (!enumElement.$.name) {
      throw new NullPointerException("The Enumeration's name can't be null.");
    }
    var enumData = { name: enumElement.$.name, values: [] };
    if (enumElement.ownedLiteral) {
      enumElement.ownedLiteral.forEach(function(literalIndex) {
        if(!literalIndex.$.name.toUpperCase()) {
          throw new NullPointerException(
            "The Enumeration's values can't be null.");
        }
        enumData.values.push(literalIndex.$.name.toUpperCase());
      });
    }
    this.parsedData.addEnum(enumElement.$['xmi:id'], enumData);
  }, this);
};

ModelioParser.prototype.fillAssociations = function() {
  this.rawAssociationsIndexes.forEach(function(rawAssociationsIndex) {
    var association = this.root.packagedElement[rawAssociationsIndex];

    this.parsedData.addAssociation(
      association.$['xmi:id'], {
        isUpperValuePresent: association.ownedEnd && association.ownedEnd[0].upperValue,
        name: (association.ownedEnd) ? association.ownedEnd[0].$.name : '',
        type: (association.ownedEnd) ? association.ownedEnd[0].$.type : ''
      });
  }, this);
};

ModelioParser.prototype.fillClassesAndFields = function() {
  this.rawClassesIndexes.forEach(function(classIndex) {
    var element = this.root.packagedElement[classIndex];

    if (!element.$.name) {
      throw new NullPointerException('Classes must have a name.');
    }
    this.checkForUserClass(element);
    this.addClass(element);

    if (element.ownedAttribute) {
      this.handleAttributes(element);
    }
  }, this);
};

ModelioParser.prototype.checkForUserClass = function(element) {
  if (!this.parsedData.userClassId && element.$.name.toLowerCase() === 'user') {
    this.parsedData.userClassId = element.$['xmi:id'];
  }
};

ModelioParser.prototype.handleAttributes = function(element) {
  element.ownedAttribute.forEach(function(attribute) {
    if (!attribute.$.name) {
      throw new NullPointerException(
        "No name is defined for the passed attribute, for class '"
        + element.$.name
        + "'.");
    }
    if (!parser_helper.isAnId(attribute.$.name, element.$.name)) {
      this.addField(attribute, element.$['xmi:id']);
    }
  }, this);
};

/**
 * Adds a new class in the class map.
 * @param {Object} element the class to add.
 */
ModelioParser.prototype.addClass = function(element) {
  var classData = {
    name: element.$.name
  };
  if (element.ownedComment && element.ownedComment[0].body) {
    classData.comment = element.ownedComment[0].body[0];
  }
  this.parsedData.addClass(element.$['xmi:id'], classData);
};

/**
 * Adds a new field to the field map.
 * @param {Object} element the field to add.
 * @param {string} classId the encapsulating class' id.
 */
ModelioParser.prototype.addField = function(element, classId) {
  if (element.$.association) {
    this.addInjectedField(element, classId);
  } else {
    this.addRegularField(element, classId);
  }
};

/**
 * Adds a (regular, not injected) field to the field map.
 * @param {Object} element the new field to add.
 * @param {string} classId the class' id.
 */
ModelioParser.prototype.addRegularField = function(element, classId) {
  var fieldData = { name: _s.decapitalize(element.$.name) };
  if (element.$.type) {
    fieldData.type = element.$.type;
  } else if (!element.type) {
      throw new NoTypeException(
        "The field '"
        + element.$.name
        + "' does not possess any type, exiting now.");
  } else {
    var typeName =
      _s.capitalize(parser_helper.getTypeNameFromURL(element.type[0].$.href));
    this.addType(typeName, typeName); // id = name
    fieldData.type = typeName;
  }

  if (element.ownedComment && element.ownedComment[0].body) {
    fieldData.comment = element.ownedComment[0].body[0];
  }

  this.parsedData.addField(element.$['xmi:id'], fieldData);
  this.parsedData.addFieldToClass(classId, element.$['xmi:id']);
};

/**
 * Adds an injected field to the corresponding map.
 * @param {Object} element the field to add.
 * @param {string} classId the id of the class containing this field.
 */
ModelioParser.prototype.addInjectedField = function(element, classId) {
  var injectedFieldData = {
    name: _s.decapitalize(element.$.name),
    type: element.$.type,
    association: element.$.association,
    'class': classId
  };

  if (element.upperValue && element.upperValue[0].$.value) {
    injectedFieldData.isUpperValuePresent = element.upperValue[0].$.value === '*';
  }

  injectedFieldData.cardinality = parser_helper.getCardinality(
    injectedFieldData,
    this.parsedData.associations);

  if (element.ownedComment && element.ownedComment[0].body) {
    injectedFieldData.comment = element.ownedComment[0].body[0];
  }

  this.parsedData.addInjectedField(element.$['xmi:id'], injectedFieldData);
  this.parsedData.addInjectedFieldToClass(classId, element.$['xmi:id']);
};

/**
 * Fills the existing fields with the present validations.
 * @throws NoValidationNameException if no validation name exists for the
 *                                   validation value (1 for no minlength for
 *                                   instance).
 * @throws WrongValidationException if JHipster doesn't support the
 *                                  validation.
 */
ModelioParser.prototype.fillConstraints = function() {
  this.rawValidationRulesIndexes.forEach(function(index) {
    var constraint = this.root.ownedRule[index];
    var name = constraint.$.name;

    if (!name) {
      throw new NoValidationNameException('The validation has no name.');
    }

    // not nil, but ''
    var value = constraint.specification[0].$.value;

    if (!name && !value) {
      return;
    }

    if (!this.databaseTypes.isValidationSupportedForType(
        this.parsedData.getType(this.parsedData.getField(constraint.$.constrainedElement).type).name,
        name)) {
      throw new WrongValidationException(
        "The validation '"
        + name
        + "' isn't supported for the type '"
        + this.parsedData.getType(this.parsedData.getField(constraint.$.constrainedElement).type).name
        + "', exiting now.");
    }
    this.parsedData.addValidationToField(
      constraint.$.constrainedElement,
      name,
      value);
  }, this);
};

ModelioParser.prototype.extractDataFromPackage = function(index) {
  while (true) {
    this.root.packagedElement[index].forEach(function(element, index) {

    }, this);
  }
};
