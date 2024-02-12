//Note all resources should include user.id in the where statement to help ensure that users can only access resources belonging to them
//Posts should first add the user.id to the object as well as all associations to ensure proper ownership, the addPropertyToDatabaseObject recursive function can be used for this purpose

const db = require('../models/index.js');
const {unwrapQueryResults, checkForEmptyResults, processQueryError} = require('../utilities/database-utilities.js');
const _ = require('lodash');

//Gets all user invoices
//As the function returns a middleware, it must be called by the route even if status is not provided (ie. with parenthases at the end)
//Optional argument "status" should be a string of "draft", "pending", or "paid"
function getUserInvoices(status = undefined){
    return (req, res, next) => {
        //Creates the proper where clause depending on if a status was provided
        let whereClause;
        if(status){
            whereClause = {
                userId: req.user.id,
                status: status
            };
        }else{
            whereClause = {
                userId: req.user.id,
            };
        }
        db.invoice.findAll({
            where: whereClause,
            include: [{
                model: db.invoiceItem,
            }]
        }).then(results =>  {
            checkForEmptyResults(results);
            return results;
        }).then(results => {
            req.invoices = unwrapQueryResults(results);
            next();
        }).catch(err => {
            next(processQueryError(err));
        });
    }; 
};

//Gets all user invoices by page using req.pageNumber and req.resultsPerPage
//As the function returns a middleware, it must be called by the route even if status is not provided (ie. with parenthases at the end)
//Optional argument "status" should be a string of "draft", "pending", or "paid"
function getPaginatedUserInvoices(status = undefined){
    return (req, res, next) => {
        //Creates the proper where clause depending on if a status was provided
        let whereClause
        if(status){
            whereClause = {
                userId: req.user.id,
                status: status
            };
        }else{
            whereClause = {
                userId: req.user.id
            };
        }
        db.invoice.findAndCountAll({
            where: whereClause,
            include: [{
                model: db.invoiceItem,
                separate: true
            }],
            limit: req.resultsPerPage,
            offset: (req.pageNumber - 1) * req.resultsPerPage
        }).then(results =>  {
            checkForEmptyResults(results.rows);
            return results;
        }).then(results => {
            req.metadata = {
                page: req.pageNumber,
                totalPages: Math.ceil(results.count / req.resultsPerPage),
                totalInvoices: results.count
            };
            req.page = unwrapQueryResults(results.rows);
            next();
        }).catch(err => {
            next(processQueryError(err));
        });
    }
};

function getUserInvoiceById(req, res, next){
    db.invoice.findOne({
        where: {
            userId: req.user.id,
            id: req.invoiceId
        },
        include: [{
            model: db.invoiceItem
        }]
    }).then(results => {
        checkForEmptyResults(results);
        return unwrapQueryResults(results);
    }).then(results => {
        req.invoice = results;
        next();
    }).catch(err => {
        next(processQueryError(err));
    });
};

function postUserInvoice(req, res, next){
    db.invoice.create(
        req.newInvoice, {
            include:[{
                model:  db.invoiceItem
            }]
        }
    ).then(results => {
        checkForEmptyResults(results);
        return unwrapQueryResults(results);
    }).then(results => {
        req.newInvoice = results;
        next();
    }).catch(err => {
        next(processQueryError(err));
    });
};

async function putUserInvoiceById(req, res, next){
    let t;
    try{
        //Creates the new transaction where all queries will be added
        t = await db.sequelize.transaction();
        
        //Query to update the invoice (excluding associations)
        await db.invoice.update(
            //Adds the user id to the appropriate records before submitting the query
            req.newInvoice, {
                where: {
                    id: req.invoiceId,
                    userId: req.user.id,
                },
                transaction: t
            })
        
        //Creates a list of invoiceItem ids submitted with the updated invoice that already exist, (i.e. non new/existing invoiceItems)
        const idsToUpdate = req.newInvoice.invoiceItems
        //Removes invoiceItems that don't have an id property
        .filter(ingredient => ingredient.id)
        //Returns the id for each remaining invoiceItem
        .map(ingredient => ingredient.id)
        //Query to delete any invoiceItems that were present in the original invoice, but not present in the updated invoice
        await db.invoiceItem.destroy({
            where: {
                id: {
                    [db.Sequelize.Op.notIn]: idsToUpdate,
                },
                invoiceId: req.invoice.id
            },
            transaction: t
        })

        //Loops over the invoiceItems in the new invoice and adds a query to the transaction to either update or create the record
        for(let invoiceItem of req.newInvoice.invoiceItems){
            
            //Updates the invoiceItem if it exists, or creates it if it's new
            await db.invoiceItem.upsert(
                invoiceItem, {
                    where: {
                        invoiceId: req.invoice.id,
                        userId: req.user.id
                    },
                    transaction: t
                }
            )
        } 
        //Commits the transaction's queries
        await t.commit();
        next();

    }catch(err){
        //Roles back any queries if the transaction throws an error
        if (t) {
            await t.rollback().then(delete t)
            .catch(err => {
                next(processQueryError(err));
            });
        }
        next(processQueryError(err));
    }
};

function deleteUserInvoiceById(req, res, next){
    db.invoice.destroy({
        where: {
            userId: req.user.id,
            id: req.invoiceId
        }
    }).then(results => {
        next()
    }).catch(err => {
        next(processQueryError(err));
    });
}

module.exports = {
    getUserInvoices,
    getUserInvoiceById,
    getPaginatedUserInvoices,
    postUserInvoice,
    deleteUserInvoiceById,
    putUserInvoiceById
};